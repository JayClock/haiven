// © 2024 Thoughtworks, Inc. | Licensed under the Apache License, Version 2.0  | See LICENSE.md file for permissions.
import React, { useState, useEffect } from "react";
import { fetchSSE } from "../app/_fetch_sse";
import {
  Drawer,
  Card,
  Spin,
  Button,
  Input,
  Collapse,
  Tooltip,
  message,
} from "antd";
const { TextArea } = Input;
import ChatExploration from "./_chat_exploration";
import { parse } from "best-effort-json-parser";
import { RiFileCopyLine, RiChat2Line, RiPushpinLine } from "react-icons/ri";
import { MenuFoldOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import ContextChoice from "../app/_context_choice";
import PromptPreview from "../app/_prompt_preview";
import HelpTooltip from "../app/_help_tooltip";
import Disclaimer from "./_disclaimer";
import { addToPinboard } from "../app/_local_store";
import CardActions from "../app/_card_actions";

let ctrl;

const CardsChat = ({ promptId, contexts, models, prompts }) => {
  const [selectedPromptId, setSelectedPromptId] = useState(promptId); // via query parameter
  const [selectedPromptConfiguration, setSelectedPromptConfiguration] =
    useState({});

  const [scenarios, setScenarios] = useState([]);
  const [isLoading, setLoading] = useState(false);
  const [selectedContext, setSelectedContext] = useState("");
  const [promptInput, setPromptInput] = useState("");

  const [cardExplorationDrawerOpen, setCardExplorationDrawerOpen] =
    useState(false);
  const [cardExplorationDrawerTitle, setCardExplorationDrawerTitle] =
    useState("Explore");

  const [currentAbortController, setCurrentAbortController] = useState();

  const [followUpResults, setFollowUpResults] = useState({});
  const [chatContext, setChatContext] = useState({});
  const [isExpanded, setIsExpanded] = useState(true);

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
  }, [promptId, prompts]);

  const onCollapsibleIconClick = (e) => {
    setIsExpanded(!isExpanded);
  };

  function abortLoad() {
    ctrl && ctrl.abort("User aborted");
    setLoading(false);
  }

  function abortCurrentLoad() {
    setLoading(false);
    currentAbortController && currentAbortController.abort("User aborted");
  }

  const handleContextSelection = (value) => {
    setSelectedContext(value);
  };

  const onExplore = (id) => {
    setCardExplorationDrawerTitle("Explore scenario: " + scenarios[id].title);
    setChatContext({
      id: id,
      firstStepInput: promptInput,
      type: "prompt",
      previousPromptId: selectedPromptId,
      context: selectedContext,
      itemSummary: scenarioToText(scenarios[id]),
      ...scenarios[id],
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

  const onCopyAll = () => {
    const allScenarios = scenarios.map(scenarioToText);
    navigator.clipboard.writeText(allScenarios.join("\n\n"));
    copySuccess();
  };

  const onCopy = (id) => {
    navigator.clipboard.writeText(scenarioToText(scenarios[id]));

    copySuccess();
  };

  const onPin = (id) => {
    const timestamp = Math.floor(Date.now()).toString();
    addToPinboard(
      timestamp,
      "## " + scenarios[id].title + "\n\n" + scenarios[id].summary,
    );
  };

  const onCopyFollowUp = (id) => {
    navigator.clipboard.writeText(followUpResults[id]);
    copySuccess();
  };

  const buildRequestDataFirstStep = () => {
    return {
      userinput: promptInput,
      context: selectedContext,
      promptid: selectedPromptConfiguration.identifier,
    };
  };

  const buildRequestDataSecondStep = (followUpId) => {
    return {
      userinput: promptInput,
      context: selectedContext,
      promptid: followUpId,

      scenarios: scenarios.map(scenarioToJson), // title, content
      previous_promptid: selectedPromptConfiguration.identifier,
    };
  };

  const sendFirstStepPrompt = () => {
    abortLoad();
    ctrl = new AbortController();
    setLoading(true);

    const uri = "/api/prompt";

    let ms = "";
    let output = [];

    fetchSSE(
      uri,
      {
        method: "POST",
        signal: ctrl.signal,
        body: JSON.stringify(buildRequestDataFirstStep()),
      },
      {
        json: true,
        onErrorHandle: () => {
          abortLoad(ctrl);
        },
        onFinish: () => {
          if (ms == "") {
            message.warning(
              "Model failed to respond rightly, please rewrite your message and try again",
            );
          }
          setLoading(false);
        },
        onMessageHandle: (data) => {
          ms += data.data;
          ms = ms.trim().replace(/^[^[]+/, "");
          if (ms.startsWith("[")) {
            try {
              output = parse(ms || "[]");
            } catch (error) {
              console.log("error", error);
            }
            if (Array.isArray(output)) {
              setScenarios(output);
            } else {
              abortLoad(ctrl);
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

  const sendFollowUpPrompt = (apiEndpoint, onData, followUpId) => {
    abortCurrentLoad();
    const ctrl = new AbortController();
    setCurrentAbortController(ctrl);
    setLoading(true);

    let ms = "";

    fetchSSE(
      apiEndpoint,
      {
        body: JSON.stringify(buildRequestDataSecondStep(followUpId)),
        signal: ctrl.signal,
      },
      {
        onErrorHandle: () => {
          abortLoad(ctrl);
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
          setLoading(false);
        },
      },
    );
  };

  const onFollowUp = (followUpId) => {
    sendFollowUpPrompt(
      "/api/prompt/follow-up",
      (result) => {
        console.log("updating follow up result", followUpId);
        followUpResults[followUpId] = result;
        setFollowUpResults(followUpResults);
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
              size="small"
              className="go-button"
            >
              GENERATE
            </Button>
            {followUpResults[followUp.identifier] && (
              <>
                <div className="generated-text-results">
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
          <PromptPreview buildRenderPromptRequest={buildRequestDataFirstStep} />
          <Button
            onClick={sendFirstStepPrompt}
            className="go-button"
            disabled={isLoading}
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

  const camelCaseToHumanReadable = (str) => {
    return str
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase());
  };

  const renderScenarioDetails = (scenario) => {
    return Object.keys(scenario).map((key) => {
      if (key === "title" || key === "summary" || key === "hidden") return null;
      const value = scenario[key];
      return (
        <div key={key}>
          <strong>{camelCaseToHumanReadable(key)}:</strong>
          {Array.isArray(value) ? (
            <ul>
              {value.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : (
            <span> {value}</span>
          )}
        </div>
      );
    });
  };

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
            <div className="prompt-chat-header">
              <h1 className="title-for-collapsed-panel">
                {selectedPromptConfiguration.title}
              </h1>
              {isLoading && (
                <div className="user-input">
                  <Spin />
                  <Button
                    type="secondary"
                    danger
                    onClick={abortLoad}
                    className="stop-button"
                  >
                    STOP
                  </Button>
                </div>
              )}
              {scenarios && scenarios.length > 0 && (
                <Button type="link" className="copy-all" onClick={onCopyAll}>
                  <RiFileCopyLine fontSize="large" /> COPY ALL
                </Button>
              )}
            </div>
            <div className={"scenarios-collection grid-display"}>
              <div className="cards-container">
                {scenarios.map((scenario, i) => {
                  return (
                    <Card title={scenario.title} key={i} className="scenario">
                      <div className="scenario-card-content">
                        {selectedPromptConfiguration.editable ? (
                          <TextArea
                            value={scenario.summary}
                            onChange={(e) => {
                              const updatedScenarios = [...scenarios];
                              updatedScenarios[i].summary = e.target.value;
                              setScenarios(updatedScenarios);
                            }}
                            rows={4}
                            data-testid={`scenario-summary-${i}`}
                          />
                        ) : (
                          <ReactMarkdown
                            className="scenario-summary"
                            data-testid={`scenario-summary-${i}`}
                          >
                            {scenario.summary}
                          </ReactMarkdown>
                        )}
                        {renderScenarioDetails(scenario)}
                      </div>
                      <CardActions
                        scenario={scenario}
                        onExploreHandler={onExplore}
                      />
                    </Card>
                  );
                })}
              </div>
              {scenarios.length > 0 && followUpCollapseItems.length > 0 && (
                <div className="follow-up-container">
                  <div style={{ marginTop: "1em" }}>
                    <h3>What you can do next</h3>
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
      </div>
    </>
  );
};

export default CardsChat;
