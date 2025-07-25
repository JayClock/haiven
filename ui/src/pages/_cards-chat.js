// © 2024 Thoughtworks, Inc. | Licensed under the Apache License, Version 2.0  | See LICENSE.md file for permissions.
import React, { useEffect, useState } from "react";
import { fetchSSE } from "../app/_fetch_sse";
import { Button, Collapse, Drawer, Form, Input } from "antd";
import ChatExploration from "./_chat_exploration";
import { parse } from "best-effort-json-parser";
import {
  RiAttachment2,
  RiFileCopyLine,
  RiPushpinLine,
  RiSendPlane2Line,
  RiGlobalLine,
} from "react-icons/ri";
import { UpOutlined } from "@ant-design/icons";
import { toast } from "react-toastify";
import ChatHeader from "./_chat_header";
import ContextChoice from "../app/_context_choice";
import HelpTooltip from "../app/_help_tooltip";
import CardsList from "../app/_cards-list";
import useLoader from "../hooks/useLoader";
import {
  addToPinboard,
  getSortedUserContexts,
  getSummaryForTheUserContext,
} from "../app/_local_store";
import LLMTokenUsage from "../app/_llm_token_usage";
import PromptPreview from "../app/_prompt_preview";
import MarkdownRenderer from "../app/_markdown_renderer";
import { scenarioToText } from "../app/_dynamic_data_renderer";
import EnrichCard from "../app/_enrich_card";
import Citations from "../pages/_citations";
import DownloadPrompt from "../app/_download_prompt";
import { formattedUsage } from "../app/utils/tokenUtils";
import { aggregateTokenUsage } from "../app/utils/_aggregate_token_usage";
import { filterSSEEvents } from "../app/utils/_sse_event_filter";

const CardsChat = ({
  promptId,
  contexts,
  models,
  prompts,
  featureToggleConfig,
}) => {
  const [progress, setProgress] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState(promptId); // via query parameter
  const [selectedPromptConfiguration, setSelectedPromptConfiguration] =
    useState({});

  const [scenarios, setScenarios] = useState([]);
  const [citations, setCitations] = useState([]);
  const { loading, abortLoad, startLoad, StopLoad } = useLoader();
  const [selectedContexts, setSelectedContexts] = useState([]);
  const [promptInput, setPromptInput] = useState("");

  const [enableGenerateMoreCards, setEnableGenerateMoreCards] = useState(true);

  const [cardExplorationDrawerOpen, setCardExplorationDrawerOpen] =
    useState(false);
  const [cardExplorationDrawerTitle, setCardExplorationDrawerTitle] =
    useState("Explore");

  const [followUpResults, setFollowUpResults] = useState({});
  const [chatContext, setChatContext] = useState({});
  const [isPromptOptionsMenuExpanded, setPromptOptionsMenuExpanded] =
    useState(false);
  const [isInputCollapsed, setIsInputCollapsed] = useState(false);
  const [isCompanyResearch, setIsCompanyResearch] = useState(false);
  const [isCompanyResearchEvolutionPage, setIsCompanyResearchEvolutionPage] =
    useState(false);
  const [followUpText, setFollowUpText] = useState("");
  const [usePromptId, setUsePromptId] = useState(true);
  const [chatSessionIdCardBuilding, setChatSessionIdCardBuilding] = useState();
  const [allContexts, setAllContexts] = useState([]);
  // Aggregate token usage per page
  const [tokenUsage, setTokenUsage] = useState({
    input_tokens: 0,
    output_tokens: 0,
  });

  function combineAllContexts(contexts) {
    const userContexts = getSortedUserContexts();
    const userContextsForDropdown = userContexts.map((context) => ({
      value: context.title,
      label: context.title,
      isUserDefined: true,
    }));
    if (contexts !== undefined && contexts.length > 0) {
      setAllContexts(contexts.concat(userContextsForDropdown));
    } else {
      setAllContexts(userContextsForDropdown);
    }
  }

  useEffect(() => {
    if (selectedPromptId !== undefined && selectedPromptId !== null) {
      const firstStepEntry = prompts.find(
        (entry) => entry.value === selectedPromptId,
      );

      const promptConfig = prompts.find(
        (entry) => entry.value === selectedPromptId,
      );
      setIsCompanyResearch(promptConfig?.grounded === true);

      // special case for one particular prompt
      // TODO: How to make this a proper feature that doesn't rely on a prompt ID?
      setIsCompanyResearchEvolutionPage(
        selectedPromptId.includes("company-research-product-evolution"),
      );

      if (firstStepEntry) {
        firstStepEntry.followUps.forEach((followUp) => {
          followUpResults[followUp.identifier] = "";
        });
        setFollowUpResults(followUpResults);
        setSelectedPromptConfiguration(firstStepEntry);
      }
      combineAllContexts(contexts);
    }
    setUsePromptId(true);

    // Reset token usage aggregation on mount (page load)
    setTokenUsage({ input_tokens: 0, output_tokens: 0 });

    const handleStorageChange = () => {
      combineAllContexts(contexts);
    };

    window.addEventListener("update-context", handleStorageChange);

    return () => {
      window.removeEventListener("update-context", handleStorageChange);
    };
  }, [promptId, prompts]);

  const onClickAdvancedPromptOptions = (e) => {
    setPromptOptionsMenuExpanded(!isPromptOptionsMenuExpanded);
  };

  const onExplore = (scenario) => {
    setCardExplorationDrawerTitle("Explore scenario: " + scenario.title);
    const chatContext = {
      id: scenario.id,
      firstStepInput: promptInput,
      type: "prompt",
      previousPromptId: selectedPromptId,
      itemSummary: scenarioToText(scenario),
      ...scenario,
    };
    attachContextsToRequestBody(chatContext);

    setChatContext(chatContext);
    setCardExplorationDrawerOpen(true);
  };

  const scenarioToJson = (scenario) => {
    const result = { title: scenario.title, content: scenario.summary };
    if (scenario.scenarios) {
      result.scenarios = scenario.scenarios.map(scenarioToJson);
    }
    return result;
  };

  const copySuccess = () => {
    toast.success("Content copied successfully!");
  };

  const onCopyFollowUp = (id) => {
    navigator.clipboard.writeText(followUpResults[id]);
    copySuccess();
  };

  const onPinFollowUp = (id) => {
    const timestamp = Math.floor(Date.now()).toString();
    addToPinboard(timestamp, followUpResults[id]);
  };

  const attachContextsToRequestBody = (requestBody) => {
    const userContextsSummary = selectedContexts
      .filter((context) => context.isUserDefined)
      .map((context) => getSummaryForTheUserContext(context.value))
      .join("\n\n");

    const knowledgePackContexts = selectedContexts
      .map((context) => (!context.isUserDefined ? context.value : null))
      .filter((value) => value !== null);

    if (userContextsSummary !== "") {
      requestBody.userContext = userContextsSummary;
    }
    if (knowledgePackContexts.length > 0) {
      requestBody.contexts = knowledgePackContexts;
    }
  };

  const buildRequestDataCardBuilding = () => {
    const requestBody = {
      userinput: promptInput,
      promptid: usePromptId
        ? selectedPromptConfiguration?.identifier
        : undefined,
    };
    attachContextsToRequestBody(requestBody);

    return requestBody;
  };

  const buildRequestDataGetMore = () => {
    const requestBody = {
      userinput:
        "Give me some additional ones, in the same JSON format. Do not repeat any of the ones you already told me about, come up with new ideas.\n\n" +
        "\n\nOnly return JSON, nothing else.\n",
      promptid: undefined,
      chatSessionId: chatSessionIdCardBuilding,
      json: true,
    };
    attachContextsToRequestBody(requestBody);

    return requestBody;
  };

  const buildRequestDataFollowUp = (followUpId, followUpQuery) => {
    const requestBody = {
      userinput: `${promptInput} ${followUpQuery}`,
      promptid: followUpId,
      scenarios: scenarios
        .filter((scenario) => scenario.exclude !== true)
        .map(scenarioToJson),
      previous_promptid: selectedPromptConfiguration.identifier,
    };
    attachContextsToRequestBody(requestBody);

    return requestBody;
  };

  // Reset the chat session to start fresh
  const resetChatSession = () => {
    setChatSessionIdCardBuilding(undefined);
    setFollowUpResults({});
  };

  const sendCardBuildingPrompt = (requestData, shouldReset = false) => {
    setIsInputCollapsed(true);
    // Do not reset token usage here; we want to aggregate per page

    if (shouldReset) {
      resetChatSession();
    }

    const uri = "/api/prompt";

    let ms = "";
    let output = [];

    fetchSSE(
      uri,
      {
        method: "POST",
        signal: startLoad(),
        body: JSON.stringify(requestData),
      },
      {
        json: true,
        onErrorHandle: () => {
          abortLoad();
        },
        onFinish: () => {
          if (ms == "") {
            toast.warning(
              "Model failed to respond rightly, please rewrite your message and try again",
            );
          }
          abortLoad();
        },
        onMessageHandle: (data, response) => {
          const chatId = response.headers.get("X-Chat-ID");
          setChatSessionIdCardBuilding(chatId);

          const existingScenarios = shouldReset
            ? []
            : scenarios.map((scenario) => ({
                ...scenario,
              }));

          // --- NEW: Use filterSSEEvents for all string chunks ---
          if (typeof data === "string") {
            const { text, events } = filterSSEEvents(data);
            events.forEach((event) => {
              if (event.type === "token_usage") {
                const usage = formattedUsage(event.data);
                setTokenUsage((prev) => aggregateTokenUsage(prev, usage));
              }
            });
            ms += text;
            // Continue to parse ms as before
          } else if (typeof data === "object" && data.type === "token_usage") {
            const usage = formattedUsage(data.data);
            setTokenUsage((prev) => aggregateTokenUsage(prev, usage));
            return;
          } else if (data.data) {
            ms += data.data;
          } else if (data.metadata) {
            // Safely handle citations if they exist in metadata
            if (data.metadata.citations) {
              setCitations(data.metadata.citations);
            }
          }
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
                toast.error(ms);
              } else {
                toast.warning(
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

  const sendFirstStepPrompt = (shouldReset = true) => {
    setIsInputCollapsed(true);
    sendCardBuildingPrompt(buildRequestDataCardBuilding(), shouldReset);
  };

  const sendGetMorePrompt = () => {
    sendCardBuildingPrompt(buildRequestDataGetMore());
  };

  const sendFollowUpPrompt = (
    apiEndpoint,
    onData,
    followUpId,
    followUpQuery,
  ) => {
    let ms = "";

    fetchSSE(
      apiEndpoint,
      {
        body: JSON.stringify(
          buildRequestDataFollowUp(followUpId, followUpQuery),
        ),
        signal: startLoad(),
      },
      {
        onErrorHandle: () => {
          abortLoad();
        },
        onMessageHandle: (data) => {
          try {
            // If this is a string chunk, filter out SSE events
            if (typeof data === "string") {
              const { text, events } = filterSSEEvents(data);
              // Handle token usage events if present
              events.forEach((event) => {
                if (event.type === "token_usage") {
                  const usage = formattedUsage(event.data);
                  setTokenUsage((prev) => aggregateTokenUsage(prev, usage));
                }
              });
              ms += text;
              onData(ms);
              return;
            }
            // If this is a structured token usage event (for future-proofing)
            if (typeof data === "object" && data.type === "token_usage") {
              const usage = formattedUsage(data.data);
              setTokenUsage((prev) => aggregateTokenUsage(prev, usage));
              return;
            }
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
        console.log("Ji", result);
        setFollowUpResults((prevResults) => ({
          ...prevResults,
          [followUpId]: result,
        }));
      },
      followUpId,
      followUpText,
    );
  };

  const followUpCollapseItems =
    selectedPromptConfiguration.followUps?.map((followUp, i) => {
      return {
        key: followUp.identifier,
        label: (
          <div>
            {followUp.title}
            <br />
            <span style={{ fontWeight: "normal" }}>
              {followUp.help_prompt_description}
            </span>
          </div>
        ),
        children: (
          <div className="second-step-section">
            {isCompanyResearchEvolutionPage &&
              !followUpResults[followUp.identifier] && (
                <Input.TextArea
                  placeholder="Provide an overview of the account's product, to identify market competitors, and leverage generative AI to suggest impactful client-ready enhancements."
                  onChange={(e, v) => {
                    setFollowUpText(e.target.value);
                  }}
                />
              )}
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
                  <MarkdownRenderer
                    content={followUpResults[followUp.identifier]}
                  />
                </div>
                <Input.TextArea
                  placeholder="Please enter follow up query"
                  onChange={(e, v) => {
                    setFollowUpText(e.target.value);
                  }}
                />
              </>
            )}
            <Button
              onClick={() => onFollowUp(followUp.identifier)}
              className="go-button"
            >
              {followUpResults[followUp.identifier] ? "SUBMIT" : "GENERATE"}
            </Button>
          </div>
        ),
      };
    }) || [];

  const inputAreaRender = () => {
    const [form] = Form.useForm();

    const handleKeyDown = (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.submit();
      }
    };

    const handleContextSelection = (values) => {
      const selectedContexts = allContexts.filter((context) =>
        values.includes(context.value),
      );
      setSelectedContexts(selectedContexts);
    };

    const advancedPromptingMenu = (
      <div className="prompt-chat-options-section">
        <div className="requirement-user-input">
          <ContextChoice
            onChange={handleContextSelection}
            contexts={allContexts}
            selectedContexts={selectedContexts}
          />
        </div>
      </div>
    );

    const inputAreaContent = (
      <div className="card-chat-input-container">
        <div>
          <Form
            onFinish={async () => {
              setIsInputCollapsed(true);
              sendFirstStepPrompt(true);
            }}
            form={form}
            initialValues={{ question: "" }}
            className="chat-text-area-form"
          >
            <Form.Item
              name="question"
              rules={[{ required: true, message: "" }]}
              className="chat-text-area"
            >
              <Input.TextArea
                disabled={loading}
                required
                data-testid="user-input-text-area"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder={selectedPromptConfiguration.help_user_input}
                autoSize={{ minRows: 4, maxRows: 15 }}
                onKeyDown={handleKeyDown}
              />
            </Form.Item>
            <Form.Item className="chat-text-area-submit">
              <Button
                htmlType="submit"
                icon={<RiSendPlane2Line fontSize="large" />}
                disabled={loading}
              >
                SEND
              </Button>
            </Form.Item>
          </Form>
          <div className="prompt-options-menu prompt-options-cards">
            <div
              className="attach-context-collapse"
              onClick={onClickAdvancedPromptOptions}
            >
              <div
                className="advanced-prompting"
                data-testid="advanced-prompting"
              >
                <RiAttachment2 className="advanced-prompting-icon" />{" "}
                <span>Attach more context</span>{" "}
                <UpOutlined
                  className="advanced-prompting-collapse-icon"
                  rotate={isPromptOptionsMenuExpanded ? 180 : 0}
                />
              </div>
            </div>
            <div className="prompt-controls">
              <PromptPreview
                renderPromptRequest={buildRequestDataCardBuilding}
                disableEdit={true}
                sampleInput={selectedPromptConfiguration?.help_sample_input}
              />
            </div>
          </div>
        </div>

        {isPromptOptionsMenuExpanded && (
          <div className="prompt-options-expanded">{advancedPromptingMenu}</div>
        )}
      </div>
    );

    return (
      <Collapse
        className="input-area-collapse"
        data-testid="input-area-collapse"
        activeKey={isInputCollapsed ? [] : ["input-area"]}
        defaultActiveKey={["input-area"]} // Ensure it's expanded on initial load
        expandIconPosition="end"
        onChange={(key) => setIsInputCollapsed(key.length === 0)}
        items={[
          {
            key: "input-area",
            label: (
              <div className="input-area-collapse-label">
                {promptInput && (
                  <div>
                    <span>Your input: </span>
                    <span className="prompt-preview">
                      {promptInput.length > 60
                        ? `${promptInput.substring(0, 60)}...`
                        : promptInput}
                    </span>
                  </div>
                )}
              </div>
            ),
            children: inputAreaContent,
          },
        ]}
      />
    );
  };

  const title = (
    <div className="title">
      <h3>
        {isCompanyResearch && <RiGlobalLine />}
        {selectedPromptConfiguration.title}
        <HelpTooltip
          text={selectedPromptConfiguration.help_prompt_description}
        />
      </h3>
      <DownloadPrompt prompt={selectedPromptConfiguration} />
      <LLMTokenUsage
        tokenUsage={tokenUsage}
        featureToggleConfig={featureToggleConfig}
      />
    </div>
  );

  const onDeleteCard = (index) => {
    if (index.section !== undefined) {
      if (index.card !== undefined) {
        scenarios[index.section].scenarios = scenarios[
          index.section
        ].scenarios.filter((_, i) => i !== index.card);
        setScenarios([...scenarios]);
      } else {
        const updatedScenarios = scenarios.filter(
          (_, i) => i !== index.section,
        );
        setScenarios(updatedScenarios);
      }
    } else {
      const updatedScenarios = scenarios.filter((_, i) => i !== index.card);
      setScenarios(updatedScenarios);
    }
  };

  const perplexityModelName = { chat: { name: "Perplexity AI" } };

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
          scenarioQueries={selectedPromptConfiguration.scenario_queries || []}
          featureToggleConfig={featureToggleConfig}
          setTokenUsage={setTokenUsage}
          tokenUsage={tokenUsage}
        />
      </Drawer>
      <div id="canvas">
        <div className="prompt-chat-container">
          <div className="chat-container-wrapper">
            <ChatHeader
              models={isCompanyResearch ? perplexityModelName : models}
              titleComponent={title}
            />
            <div className="card-chat-container card-chat-overflow">
              <CardsList
                showBiggerCards={isCompanyResearch}
                progress={progress}
                isGenerating={isGenerating}
                featureToggleConfig={featureToggleConfig}
                scenarios={scenarios}
                setScenarios={setScenarios}
                editable={selectedPromptConfiguration.editable}
                onExplore={onExplore}
                stopLoadComponent={<StopLoad />}
                onDelete={onDeleteCard}
              />
              {inputAreaRender()}
              {scenarios.length > 0 && !isCompanyResearch && (
                <div className="generate-more">
                  <Button
                    onClick={sendGetMorePrompt}
                    className="go-button"
                    disabled={loading || !enableGenerateMoreCards}
                  >
                    GENERATE MORE CARDS
                  </Button>
                </div>
              )}
              {!isCompanyResearch && (
                <EnrichCard
                  startLoad={startLoad}
                  abortLoad={abortLoad}
                  loading={loading}
                  featureToggleConfig={featureToggleConfig}
                  chatSessionIdCardBuilding={chatSessionIdCardBuilding}
                  scenarios={scenarios}
                  setScenarios={setScenarios}
                  selectedPromptConfiguration={selectedPromptConfiguration}
                  setEnableGenerateMoreCards={setEnableGenerateMoreCards}
                  setIsGenerating={setIsGenerating}
                  setProgress={setProgress}
                  scenarioToJson={scenarioToJson}
                  attachContextsToRequestBody={attachContextsToRequestBody}
                  setTokenUsage={setTokenUsage}
                  tokenUsage={tokenUsage}
                />
              )}
              <div style={{ paddingLeft: "2em" }}>
                <Citations citations={citations} />
              </div>
              {scenarios.length > 0 && followUpCollapseItems.length > 0 && (
                <div className="follow-up-container">
                  <div style={{ marginTop: "1em" }}>
                    <h3>What you can do next</h3>
                    <p>Generate content based on the cards above.</p>
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
