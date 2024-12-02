// © 2024 Thoughtworks, Inc. | Licensed under the Apache License, Version 2.0  | See LICENSE.md file for permissions.
import React, { useState, useEffect } from "react";
import { fetchSSE } from "../app/_fetch_sse";
import { Drawer, Button, Input, Collapse, message } from "antd";
const { TextArea } = Input;
import ChatExploration from "./_chat_exploration";
import { parse } from "best-effort-json-parser";
import { RiFileCopyLine, RiPushpinLine } from "react-icons/ri";
import { MenuFoldOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import Disclaimer from "./_disclaimer";
import ContextChoice from "../app/_context_choice";
import PromptPreview from "../app/_prompt_preview";
import HelpTooltip from "../app/_help_tooltip";
import CardsList from "../app/_cards-list";
import useLoader from "../hooks/useLoader";
import { addToPinboard } from "../app/_local_store";

const CardsChat = ({ promptId, contexts, models, prompts }) => {
  const [selectedPromptId, setSelectedPromptId] = useState(promptId); // via query parameter
  const [selectedPromptConfiguration, setSelectedPromptConfiguration] =
    useState({});

  const [scenarios, setScenarios] = useState([]);
  const { loading, abortLoad, startLoad, StopLoad } = useLoader();
  const [selectedContext, setSelectedContext] = useState("");
  const [promptInput, setPromptInput] = useState("");

  const [cardExplorationDrawerOpen, setCardExplorationDrawerOpen] =
    useState(false);
  const [cardExplorationDrawerTitle, setCardExplorationDrawerTitle] =
    useState("Explore");

  const [followUpResults, setFollowUpResults] = useState({});
  const [chatContext, setChatContext] = useState({});
  const [isExpanded, setIsExpanded] = useState(true);
  const [usePromptId, setUsePromptId] = useState(true);
  const [chatSessionIdFirstStep, setChatSessionIdFirstStep] = useState();

  useEffect(() => {
    if (selectedPromptId !== undefined && selectedPromptId !== null) {
      const firstStepEntry = prompts.find(
        (entry) => entry.value === selectedPromptId,
      );
      if (firstStepEntry) {
        firstStepEntry.followUps.forEach((followUp) => {
          followUpResults[followUp.identifier] = "";
        });
        setFollowUpResults(followUpResults);
        setSelectedPromptConfiguration(firstStepEntry);
      }
    }
    setUsePromptId(true);
  }, [promptId, prompts]);

  const onCollapsibleIconClick = (e) => {
    setIsExpanded(!isExpanded);
  };

  const handleContextSelection = (value) => {
    setSelectedContext(value);
  };

  const onExplore = (scenario) => {
    setCardExplorationDrawerTitle("Explore scenario: " + scenario.title);
    setChatContext({
      id: scenario.id,
      firstStepInput: promptInput,
      type: "prompt",
      previousPromptId: selectedPromptId,
      context: selectedContext,
      itemSummary: scenarioToText(scenario),
      ...scenario,
    });
    setCardExplorationDrawerOpen(true);
  };

  const scenarioToText = (scenario) => {
    return "# Title: " + scenario.title + "\nDescription: " + scenario.summary;
  };

  const scenarioToJson = (scenario) => {
    return { title: scenario.title, content: scenario.summary };
  };

  const copySuccess = () => {
    message.success("Content copied successfully!");
  };

  const onCopyFollowUp = (id) => {
    navigator.clipboard.writeText(followUpResults[id]);
    copySuccess();
  };

  const onPinFollowUp = (id) => {
    const timestamp = Math.floor(Date.now()).toString();
    addToPinboard(timestamp, followUpResults[id]);
  };

  const buildRequestDataFirstStep = () => {
    return {
      userinput: promptInput,
      context: selectedContext,
      promptid: usePromptId
        ? selectedPromptConfiguration?.identifier
        : undefined,
    };
  };

  const buildRequestDataGetMore = () => {
    return {
      userinput:
        "Give me some additional ones, in the same JSON format. Only return JSON, nothing else.",
      context: selectedContext,
      promptid: undefined,
      chatSessionId: chatSessionIdFirstStep,
      json: true,
    };
  };

  const buildRequestDataSecondStep = (followUpId) => {
    return {
      userinput: promptInput,
      context: selectedContext,
      promptid: followUpId,
      scenarios: scenarios
        .filter((scenario) => scenario.exclude !== true)
        .map(scenarioToJson),
      previous_promptid: selectedPromptConfiguration.identifier,
    };
  };

  const sendCardBuildingPrompt = (requestDataBuilder) => {
    setIsExpanded(false);
    const uri = "/api/prompt";

    let ms = "";
    let output = [];

    fetchSSE(
      uri,
      {
        method: "POST",
        signal: startLoad(),
        body: JSON.stringify(requestDataBuilder()),
      },
      {
        json: true,
        onErrorHandle: () => {
          abortLoad();
        },
        onFinish: () => {
          if (ms == "") {
            message.warning(
              "Model failed to respond rightly, please rewrite your message and try again",
            );
          }
          abortLoad();
        },
        onMessageHandle: (data, response) => {
          const chatId = response.headers.get("X-Chat-ID");
          setChatSessionIdFirstStep(chatId);

          const existingScenarios = scenarios.map((scenario) => ({
            ...scenario,
          }));

          ms += data.data;
          ms = ms.trim().replace(/^[^[]+/, "");
          if (ms.startsWith("[")) {
            try {
              output = parse(ms || "[]");
            } catch (error) {
              console.log("error", error);
            }
            if (Array.isArray(output)) {
              setScenarios([...existingScenarios, ...output]);
            } else {
              abortLoad();
              if (ms.includes("Error code:")) {
                message.error(ms);
              } else {
                message.warning(
                  "Model failed to respond rightly, please rewrite your message and try again",
                );
              }
              console.log("response is not parseable into an array");
            }
          }
        },
      },
    );
  };

  const sendFirstStepPrompt = () => {
    sendCardBuildingPrompt(buildRequestDataFirstStep);
  };

  const sendGetMorePrompt = () => {
    sendCardBuildingPrompt(buildRequestDataGetMore);
  };

  const sendFollowUpPrompt = (apiEndpoint, onData, followUpId) => {
    let ms = "";

    fetchSSE(
      apiEndpoint,
      {
        body: JSON.stringify(buildRequestDataSecondStep(followUpId)),
        signal: startLoad(),
      },
      {
        onErrorHandle: () => {
          abortLoad();
        },
        onMessageHandle: (data) => {
          try {
            ms += data;

            onData(ms);
          } catch (error) {
            console.log("error", error, "data received", "'" + data + "'");
          }
        },
        onFinish: () => {
          abortLoad();
        },
      },
    );
  };

  const onFollowUp = (followUpId) => {
    sendFollowUpPrompt(
      "/api/prompt/follow-up",
      (result) => {
        setFollowUpResults((prevResults) => ({
          ...prevResults,
          [followUpId]: result,
        }));
      },
      followUpId,
    );
  };

  const followUpCollapseItems =
    selectedPromptConfiguration.followUps?.map((followUp, i) => {
      return {
        key: followUp.identifier,
        label: followUp.title,
        children: (
          <div className="second-step-section">
            <p>{followUp.help_prompt_description}</p>
            <Button
              onClick={() => onFollowUp(followUp.identifier)}
              className="go-button"
            >
              {followUpResults[followUp.identifier] ? "REGENERATE" : "GENERATE"}
            </Button>
            {followUpResults[followUp.identifier] && (
              <>
                <div className="generated-text-results">
                  <Button
                    type="link"
                    onClick={() => {
                      onPinFollowUp(followUp.identifier);
                    }}
                    className="icon-button"
                  >
                    <RiPushpinLine fontSize="large" />
                  </Button>
                  <Button
                    type="link"
                    onClick={() => {
                      onCopyFollowUp(followUp.identifier);
                    }}
                    className="icon-button"
                  >
                    <RiFileCopyLine fontSize="large" />
                  </Button>

                  <ReactMarkdown>
                    {followUpResults[followUp.identifier]}
                  </ReactMarkdown>
                </div>
              </>
            )}
          </div>
        ),
      };
    }) || [];

  const promptMenu = (
    <div>
      <div className="prompt-chat-options-section">
        <h1>{selectedPromptConfiguration.title}</h1>
        <p>{selectedPromptConfiguration.help_prompt_description}</p>
      </div>

      <div className="prompt-chat-options-section">
        <div className="user-input">
          <label>
            Your input
            <HelpTooltip text={selectedPromptConfiguration.help_user_input} />
          </label>
          <TextArea
            placeholder={selectedPromptConfiguration.help_user_input}
            value={promptInput}
            onChange={(e, v) => {
              setPromptInput(e.target.value);
            }}
            rows={18}
            data-testid="user-input"
          />
        </div>
        <ContextChoice
          onChange={handleContextSelection}
          contexts={contexts}
          value={selectedContext?.key}
        />
        <div className="user-input">
          <PromptPreview
            buildRenderPromptRequest={buildRequestDataFirstStep}
            setUsePromptId={setUsePromptId}
            startNewChat={sendFirstStepPrompt}
          />
          <Button
            onClick={sendFirstStepPrompt}
            className="go-button"
            disabled={loading}
          >
            GENERATE
          </Button>
        </div>
      </div>
    </div>
  );

  const collapseItem = [
    {
      key: "1",
      label: isExpanded ? "Hide Prompt Panel" : "Show Prompt Panel",
      children: promptMenu,
    },
  ];

  return (
    <>
      <Drawer
        title={cardExplorationDrawerTitle}
        mask={false}
        open={cardExplorationDrawerOpen}
        destroyOnClose={true}
        onClose={() => setCardExplorationDrawerOpen(false)}
        size={"large"}
      >
        <ChatExploration
          context={chatContext}
          user={{
            name: "User",
            avatar: "/boba/user-5-fill-dark-blue.svg",
          }}
          scenarioQueries={[]}
        />
      </Drawer>

      <div id="canvas">
        <div
          className={`prompt-chat-container ${isExpanded ? "" : "collapsed"}`}
          style={{ height: "auto" }}
        >
          <Collapse
            className="prompt-chat-options-container"
            items={collapseItem}
            defaultActiveKey={["1"]}
            ghost={isExpanded}
            activeKey={isExpanded ? "1" : ""}
            onChange={onCollapsibleIconClick}
            expandIcon={() => (
              <MenuFoldOutlined rotate={isExpanded ? 0 : 180} />
            )}
          />
          <div className="chat-container-wrapper">
            <Disclaimer models={models} />
            <CardsList
              title={selectedPromptConfiguration.title}
              scenarios={scenarios}
              setScenarios={setScenarios}
              editable={selectedPromptConfiguration.editable}
              selectable={
                selectedPromptConfiguration.followUps !== undefined &&
                selectedPromptConfiguration.followUps.length > 0
              }
              onExplore={onExplore}
              stopLoadComponent={<StopLoad />}
            />
            {scenarios.length > 0 && (
              <div className="generate-more">
                <Button
                  onClick={sendGetMorePrompt}
                  className="go-button"
                  disabled={loading}
                >
                  GENERATE MORE CARDS
                </Button>
              </div>
            )}
            {scenarios.length > 0 && followUpCollapseItems.length > 0 && (
              <div className="follow-up-container">
                <div style={{ marginTop: "1em" }}>
                  <h3>What you can do next</h3>
                  <p>
                    Generate content based on the cards selected above. Deselect
                    cards to exclude them from the next step.
                  </p>
                </div>
                <Collapse
                  items={followUpCollapseItems}
                  className="second-step-collapsable"
                  data-testid="follow-up-collapse"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default CardsChat;
