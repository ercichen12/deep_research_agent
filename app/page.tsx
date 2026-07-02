"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphStateSummary, SearchBatchArtifact, SourceArtifact } from "@/lib/heavy/graph/types";
import type { HeavyEvent, Inquiry, ResearchRun, Turn } from "@/lib/heavy/types";

const SAMPLE_PROMPT =
  "我要找一个公司的CEO，这个公司是做有创新性的硬件，但是不能做太阳能板，也不能做医疗器械，也不能做重工制造。公司每年最好能增长30%。这个人最好在澳大利亚，在这个企业做了三年以上，并且最近发表过包含AI观点的文章。";

type HealthState =
  | { status: "loading" }
  | {
      status: "ok";
      baseUrl: string;
      configuredModel: string;
      searchProvider: { provider?: string; relayConfigured?: boolean; openCliFallback?: boolean; webFallback?: boolean };
    }
  | { status: "error"; message: string; searchProvider?: { provider?: string; relayConfigured?: boolean } };

type ArtifactLoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export default function Home() {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [activeInquiryId, setActiveInquiryId] = useState("");
  const [activeInquiry, setActiveInquiry] = useState<Inquiry | null>(null);
  const [eventsByInquiry, setEventsByInquiry] = useState<Record<string, HeavyEvent[]>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadHealth();
    void refreshInquiries();
  }, []);

  const activeTurn = activeInquiry?.turns.at(-1) ?? null;
  const events = activeInquiryId ? (eventsByInquiry[activeInquiryId] ?? []) : [];
  const finalReport = activeTurn?.finalReport ?? null;
  const statusText = activeInquiry ? statusLabel(activeInquiry.status) : "未选择";
  const elapsed = activeTurn ? formatElapsed(activeTurn.startedAt ?? activeTurn.createdAt, activeTurn.completedAt) : "-";

  async function loadHealth() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "Health check failed");
      }
      setHealth({
        status: "ok",
        baseUrl: data.baseUrl,
        configuredModel: data.configuredModel,
        searchProvider: data.searchProvider ?? {}
      });
    } catch (caught) {
      setHealth({
        status: "error",
        message: caught instanceof Error ? caught.message : "Health check failed"
      });
    }
  }

  async function refreshInquiries() {
    const response = await fetch("/api/inquiries", { cache: "no-store" });
    const data = await response.json();
    const items = Array.isArray(data.inquiries) ? (data.inquiries as Inquiry[]) : [];
    setInquiries(items);
    setActiveInquiryId((current) => current || items[0]?.id || "");
  }

  const loadInquiry = useCallback(async (id: string): Promise<Inquiry | null> => {
    const response = await fetch(`/api/inquiries/${id}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Inquiry;
    setActiveInquiry(data);
    return data;
  }, []);

  async function startHeavyInquiry() {
    setIsRunning(true);
    setError("");

    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "Heavy inquiry failed");
      }

      setActiveInquiryId(data.inquiryId);
      await refreshInquiries();
      await loadInquiry(data.inquiryId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Heavy 运行失败");
    } finally {
      setIsRunning(false);
    }
  }

  const consumeInquiryStream = useCallback(async (inquiryId: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/inquiries/${inquiryId}/stream`, { cache: "no-store", signal });
    if (!response.ok || !response.body) {
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const nextEvents: HeavyEvent[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) {
        break;
      }
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          nextEvents.push(JSON.parse(trimmed) as HeavyEvent);
        }
      }
      setEventsByInquiry((current) => ({ ...current, [inquiryId]: [...nextEvents] }));
      await loadInquiry(inquiryId);
    }
  }, [loadInquiry]);

  useEffect(() => {
    if (!activeInquiryId) {
      return;
    }
    const controller = new AbortController();

    void (async () => {
      const inquiry = await loadInquiry(activeInquiryId);
      if (!inquiry || inquiry.status === "completed" || inquiry.status === "failed") {
        return;
      }
      await consumeInquiryStream(activeInquiryId, controller.signal).catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "事件流读取失败");
        }
      });
    })();

    return () => controller.abort();
  }, [activeInquiryId, consumeInquiryStream, loadInquiry]);

  return (
    <main className="heavy-shell">
      <aside className="heavy-sidebar">
        <div className="brand-block">
          <h1>Heavy Console</h1>
          <ProviderStatus health={health} />
        </div>

        <section className="composer-block">
          <label htmlFor="prompt">研究问题</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={9} />
          <button type="button" onClick={startHeavyInquiry} disabled={isRunning || prompt.trim().length < 10}>
            {isRunning ? "Heavy 运行中..." : "启动 Heavy"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>

        <section className="inquiry-list">
          <div className="section-head">
            <h2>本地 Inquiry</h2>
            <button type="button" className="ghost-button" onClick={refreshInquiries}>
              刷新
            </button>
          </div>
          {inquiries.map((inquiry) => (
            <button
              className={`inquiry-item ${inquiry.id === activeInquiryId ? "selected" : ""}`}
              key={inquiry.id}
              onClick={() => setActiveInquiryId(inquiry.id)}
              type="button"
            >
              <span>{statusLabel(inquiry.status)}</span>
              <strong>{inquiry.prompt}</strong>
              <small>{new Date(inquiry.updatedAt).toLocaleString()}</small>
            </button>
          ))}
          {inquiries.length === 0 ? <p className="muted">还没有本地 Heavy 任务。</p> : null}
        </section>
      </aside>

      <section className="heavy-main">
        <header className="summary-strip">
          <div>
            <span>问题</span>
            <strong>{activeInquiry?.prompt ?? "提交一个问题开始 Heavy 调研"}</strong>
          </div>
          <Metric label="模式" value="Heavy" />
          <Metric label="状态" value={statusText} />
          <Metric label="耗时" value={elapsed} />
        </header>

        <StageBar turn={activeTurn} events={events} />
        {activeInquiry?.graphState ? <GraphStatePanel graphState={activeInquiry.graphState} inquiryId={activeInquiry.id} /> : null}

        <div className="content-grid">
          <section className="workstream">
            <div className="section-head">
              <h2>Run 过程</h2>
              <span>{activeTurn ? `${activeTurn.runs.length} 轮` : "0 轮"}</span>
            </div>
            {activeTurn?.runs.map((run) => <RunPanel key={run.id} run={run} />)}
            {!activeTurn ? <p className="muted empty-state">Apodex Heavy 的结构会在这里展开：Run、派发 Agent、报告、核验和决策。</p> : null}
          </section>

          <aside className="event-panel">
            <div className="section-head">
              <h2>事件流</h2>
              <span>{events.length} 条</span>
            </div>
            <div className="event-list">
              {events.map((event, index) => (
                <EventCard event={event} key={`${event.type}-${index}`} />
              ))}
              {events.length === 0 ? <p className="muted">运行时会追加 NDJSON 事件。</p> : null}
            </div>
          </aside>
        </div>

        <section className="final-section">
          <div className="section-head">
            <h2>最终报告</h2>
            <span>{finalReport ? `${finalReport.sourceUrls.length} 个来源` : "未生成"}</span>
          </div>
          {finalReport ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalReport.markdown}</ReactMarkdown>
            </div>
          ) : (
            <p className="muted empty-state">终稿 Agent 只会读取 AgentReport、VerificationReport 和 sources 后生成 Markdown。</p>
          )}
        </section>
      </section>
    </main>
  );
}

function EventCard({ event }: { event: HeavyEvent }) {
  return (
    <article>
      <strong>{event.type}</strong>
      <small>{event.timestamp}</small>
      {"taskId" in event ? <span>{event.taskId}</span> : null}
      {event.type === "agent_research_step" ? (
        <>
          <small>
            {event.step.title} · {event.step.decision ?? event.step.type}
          </small>
          {event.step.provider ? <span>{formatSearchProvider(event.step.provider, event.step.engine)}</span> : null}
          {typeof event.step.resultCount === "number" ? <span>{event.step.resultCount} results</span> : null}
          {event.step.queries?.slice(0, 2).map((query, index) => (
            <code key={`${event.step.id}-event-query-${index}`}>{query}</code>
          ))}
        </>
      ) : null}
      {event.type === "agent_search_log" ? (
        <>
          <span>{formatSearchProvider(event.log.provider, event.log.engine)}</span>
          <span>
            {event.log.status} · {event.log.results.length} results
          </span>
          <code>{event.log.query}</code>
          {event.log.message ? <small>{event.log.message}</small> : null}
          {event.log.results.slice(0, 3).map((result, index) => (
            <a href={result.url} key={`${event.taskId}-event-result-${index}-${result.url}`} rel="noreferrer" target="_blank">
              {result.title}
            </a>
          ))}
        </>
      ) : null}
      {event.type === "agent_read_log" ? (
        <>
          <span>{event.log.provider}</span>
          <span>{event.log.status}</span>
          <a href={event.log.url} rel="noreferrer" target="_blank">
            {event.log.title}
          </a>
          {typeof event.log.readCharCount === "number" ? <small>读取 {event.log.readCharCount} 字符</small> : null}
          {event.log.message ? <small>{event.log.message}</small> : null}
        </>
      ) : null}
      {event.type === "search_batch_reported" ? (
        <>
          <span>
            {event.batch.quality} · {event.batch.dedupedResultCount} results · {event.batch.uniqueDomainCount} domains
          </span>
          {event.batch.providerCalls.map((call, index) => (
            <small key={`${event.batch.id}-provider-${index}`}>
              {formatSearchProvider(call.provider, call.engine)} · {call.status} · {call.resultCount} results · {call.query}
            </small>
          ))}
        </>
      ) : null}
      {event.type === "source_read" ? (
        <>
          <span>{formatSearchProvider(event.source.provider, event.source.engine)}</span>
          <a href={event.source.url} rel="noreferrer" target="_blank">
            {event.source.title}
          </a>
          <small>
            {event.source.status}
            {typeof event.source.readCharCount === "number" ? ` · ${event.source.readCharCount} chars` : ""}
          </small>
        </>
      ) : null}
      {event.type === "candidate_promoted" ? (
        <>
          <span>{event.candidate.name}</span>
          <small>
            {event.candidate.status} · score {event.candidate.score} · {event.reason}
          </small>
        </>
      ) : null}
      {event.type === "state_evaluated" ? (
        <>
          <span>{event.decision.action}</span>
          <small>{event.decision.reason}</small>
        </>
      ) : null}
    </article>
  );
}

function GraphStatePanel({ graphState, inquiryId }: { graphState: GraphStateSummary; inquiryId: string }) {
  const [searchArtifacts, setSearchArtifacts] = useState<Record<string, ArtifactLoadState<SearchBatchArtifact>>>({});
  const [sourceArtifacts, setSourceArtifacts] = useState<Record<string, ArtifactLoadState<SourceArtifact>>>({});

  async function loadSearchArtifact(batchId: string) {
    const existing = searchArtifacts[batchId];
    if (existing?.status === "loading" || existing?.status === "ready") {
      return;
    }
    setSearchArtifacts((current) => ({ ...current, [batchId]: { status: "loading" } }));
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/artifacts/search-batches/${batchId}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "搜索 artifact 加载失败");
      }
      setSearchArtifacts((current) => ({ ...current, [batchId]: { status: "ready", data: data as SearchBatchArtifact } }));
    } catch (caught) {
      setSearchArtifacts((current) => ({
        ...current,
        [batchId]: { status: "error", message: caught instanceof Error ? caught.message : "搜索 artifact 加载失败" }
      }));
    }
  }

  async function loadSourceArtifact(sourceHash: string) {
    const existing = sourceArtifacts[sourceHash];
    if (existing?.status === "loading" || existing?.status === "ready") {
      return;
    }
    setSourceArtifacts((current) => ({ ...current, [sourceHash]: { status: "loading" } }));
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/artifacts/sources/${sourceHash}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "网页 artifact 加载失败");
      }
      setSourceArtifacts((current) => ({ ...current, [sourceHash]: { status: "ready", data: data as SourceArtifact } }));
    } catch (caught) {
      setSourceArtifacts((current) => ({
        ...current,
        [sourceHash]: { status: "error", message: caught instanceof Error ? caught.message : "网页 artifact 加载失败" }
      }));
    }
  }

  return (
    <section className="graph-panel">
      <div className="section-head">
        <h2>Graph Research</h2>
        <span>
          Cycle {graphState.cycleIndex} · {graphState.status}
        </span>
      </div>

      <div className="graph-metrics">
        <Metric label="任务类型" value={graphState.frame.taskKind} />
        <Metric label="Actions" value={String(graphState.actionCount)} />
        <Metric label="Search Batches" value={String(graphState.searchBatchCount)} />
        <Metric label="Sources" value={String(graphState.sourceCount)} />
        <Metric label="Evidence" value={String(graphState.evidenceCount)} />
      </div>

      <div className="graph-grid">
        <section className="graph-card">
          <h3>Search Ledger</h3>
          {graphState.recentSearchBatches.map((batch) => (
            <article key={batch.id}>
              <strong>{batch.quality}</strong>
              <span>
                {batch.dedupedResultCount} results · {batch.uniqueDomainCount} domains · {batch.officialOrPrimaryCount} primary
              </span>
              {batch.providerCalls.map((call, index) => (
                <small key={`${batch.id}-${index}`}>
                  {formatSearchProvider(call.provider, call.engine)} · {call.status} · {call.resultCount} results · {call.query}
                </small>
              ))}
              <button type="button" className="ghost-button compact" onClick={() => void loadSearchArtifact(batch.id)}>
                展开搜索结果
              </button>
              <SearchArtifactPanel state={searchArtifacts[batch.id] ?? { status: "idle" }} />
            </article>
          ))}
          {graphState.recentSearchBatches.length === 0 ? <p className="muted">暂无搜索批次。</p> : null}
        </section>

        <section className="graph-card">
          <h3>Source Ledger</h3>
          {graphState.recentSources.map((source) => (
            <article key={source.sourceHash}>
              <strong>{source.title}</strong>
              <span>{source.engine ? `${source.provider} / ${source.engine}` : source.provider}</span>
              <a href={source.url} rel="noreferrer" target="_blank">
                {source.url}
              </a>
              <small>
                {source.status}
                {typeof source.readCharCount === "number" ? ` · ${source.readCharCount} chars` : ""}
              </small>
              <button type="button" className="ghost-button compact" onClick={() => void loadSourceArtifact(source.sourceHash)}>
                查看网页内容
              </button>
              <SourceArtifactPanel state={sourceArtifacts[source.sourceHash] ?? { status: "idle" }} />
            </article>
          ))}
          {graphState.recentSources.length === 0 ? <p className="muted">暂无网页来源。</p> : null}
        </section>

        <section className="graph-card">
          <h3>Candidate Pool</h3>
          {graphState.candidates.map((candidate) => (
            <article key={candidate.id}>
              <strong>{candidate.name}</strong>
              <span>
                {candidate.status} · {candidate.confidence} · {candidate.score}/100
              </span>
              <p>{candidate.summary}</p>
              {candidate.missingConstraints.length > 0 ? <small>缺口：{candidate.missingConstraints.map((item) => item.constraintId).join(", ")}</small> : null}
            </article>
          ))}
          {graphState.candidates.length === 0 ? <p className="muted">暂无候选。</p> : null}
        </section>

        <section className="graph-card">
          <h3>Evidence Matrix</h3>
          {graphState.evidenceMatrix.cells.length > 0 ? (
            <div className="matrix-table">
              <table>
                <thead>
                  <tr>
                    <th>candidate</th>
                    <th>constraint</th>
                    <th>status</th>
                    <th>source</th>
                  </tr>
                </thead>
                <tbody>
                  {graphState.evidenceMatrix.cells.map((cell) => (
                    <tr key={`${cell.candidateId}-${cell.constraintId}`}>
                      <td>{cell.candidateId}</td>
                      <td>{cell.constraintId}</td>
                      <td>{cell.status}</td>
                      <td>{cell.bestSourceUrls[0] ?? "未找到"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">暂无证据矩阵。</p>
          )}
        </section>

        <section className="graph-card">
          <h3>Decision Timeline</h3>
          {graphState.evaluatorDecisions.map((decision) => (
            <article key={decision.id}>
              <strong>
                Cycle {decision.cycle} · {decision.action}
              </strong>
              <p>{decision.reason}</p>
              {decision.unresolvedQuestions.length > 0 ? <small>{decision.unresolvedQuestions.join(", ")}</small> : null}
            </article>
          ))}
          {graphState.evaluatorDecisions.length === 0 ? <p className="muted">暂无决策。</p> : null}
        </section>
      </div>
    </section>
  );
}

function SearchArtifactPanel({ state }: { state: ArtifactLoadState<SearchBatchArtifact> }) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "loading") {
    return <p className="muted artifact-state">正在加载搜索结果...</p>;
  }
  if (state.status === "error") {
    return <p className="error artifact-state">{state.message}</p>;
  }

  return (
    <div className="artifact-detail">
      <h4>Provider Results</h4>
      {state.data.providerCalls.map((call, index) => (
        <article key={`${state.data.id}-call-${index}`}>
          <strong>{formatSearchProvider(call.provider, call.engine)}</strong>
          <small>
            {formatSearchProvider(call.provider, call.engine)} · {call.status} · {call.results.length} results
          </small>
          <code>{call.query}</code>
          {call.message ? <small>{call.message}</small> : null}
          <ol>
            {call.results.map((result) => (
              <li key={`${call.provider}-${call.engine ?? "default"}-${result.url}`}>
                <a href={result.url} rel="noreferrer" target="_blank">
                  {result.title}
                </a>
                {result.snippet ? <small>{result.snippet}</small> : null}
              </li>
            ))}
          </ol>
        </article>
      ))}
      <h4>Deduped Results</h4>
      <ol>
        {state.data.dedupedResults.map((result) => (
          <li key={result.url}>
            <a href={result.url} rel="noreferrer" target="_blank">
              {result.title}
            </a>
            {result.snippet ? <small>{result.snippet}</small> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SourceArtifactPanel({ state }: { state: ArtifactLoadState<SourceArtifact> }) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "loading") {
    return <p className="muted artifact-state">正在加载网页内容...</p>;
  }
  if (state.status === "error") {
    return <p className="error artifact-state">{state.message}</p>;
  }

  return (
    <div className="artifact-detail">
      <h4>Read Attempts</h4>
      {(state.data.readLogs ?? []).map((log, index) => (
        <small key={`${state.data.sourceHash}-read-${index}`}>
          {log.provider} · {log.status}
          {typeof log.readCharCount === "number" ? ` · ${log.readCharCount} chars` : ""}
          {log.message ? ` · ${log.message}` : ""}
        </small>
      ))}
      {(state.data.readLogs ?? []).length === 0 ? <small>暂无读取尝试日志。</small> : null}
      <h4>Excerpt</h4>
      <p>{state.data.excerpt ?? "这个网页 artifact 没有可展示正文片段。"}</p>
    </div>
  );
}

function ProviderStatus({ health }: { health: HealthState }) {
  if (health.status === "loading") {
    return <p className="provider-status">检查 provider...</p>;
  }

  if (health.status === "error") {
    return <p className="provider-status error">Provider 异常：{health.message}</p>;
  }

  return (
    <p className="provider-status">
      {health.configuredModel} · {health.searchProvider.provider ?? "relay"}
      {health.searchProvider.relayConfigured ? " · relay ready" : " · relay 未配置"}
    </p>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StageBar({ turn, events }: { turn: Turn | null; events: HeavyEvent[] }) {
  const phase = useMemo(() => {
    if (turn?.finalReport || events.some((event) => event.type === "final_started")) {
      return 3;
    }
    if (events.some((event) => event.type === "verification_started" || event.type === "verification_reported")) {
      return 2;
    }
    if (turn?.status === "running" || events.some((event) => event.type === "run_planned")) {
      return 1;
    }
    return 0;
  }, [turn, events]);

  return (
    <nav className="stage-bar" aria-label="Heavy stages">
      {["研究", "校验", "撰写"].map((label, index) => (
        <span className={phase >= index + 1 ? "active" : ""} key={label}>
          {label}
        </span>
      ))}
    </nav>
  );
}

function RunPanel({ run }: { run: ResearchRun }) {
  return (
    <details className="run-panel" open={run.index === 1}>
      <summary>
        <strong>Run {run.index}</strong>
        <span>{statusLabel(run.status)}</span>
        <small>{run.decision?.reason ?? run.coordinatorPlan?.objective ?? "等待计划"}</small>
      </summary>

      {run.coordinatorPlan ? (
        <div className="subsection">
          <h3>派发多角色 Agent</h3>
          <div className="task-grid">
            {run.coordinatorPlan.tasks.map((task) => (
              <article className="task-card" key={task.id}>
                <strong>{task.title}</strong>
                <span>{task.role}</span>
                <p>{task.objective}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="subsection">
        <h3>AgentReport</h3>
        <div className="report-list">
          {run.agentReports.map((report) => (
            <AgentReportCard report={report} key={report.agentId} />
          ))}
          {run.agentReports.length === 0 ? <p className="muted">等待 Agent 返回报告。</p> : null}
        </div>
      </div>

      {run.verificationReport ? (
        <div className="subsection verifier-block">
          <h3>核验：{run.verificationReport.status}</h3>
          <p>{run.verificationReport.summary}</p>
          <ul>
            {run.verificationReport.issues.map((issue) => (
              <li key={`${issue.type}-${issue.message}`}>
                <span>{issue.severity}</span>
                {issue.message}
              </li>
            ))}
          </ul>
          {run.verificationReport.missingEvidence.length > 0 ? (
            <small>缺口：{run.verificationReport.missingEvidence.join(", ")}</small>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function AgentReportCard({ report }: { report: ResearchRun["agentReports"][number] }) {
  const searchLogs = Array.isArray(report.searchLogs) ? report.searchLogs : [];
  const readLogs = Array.isArray(report.readLogs) ? report.readLogs : [];
  const findings = Array.isArray(report.findings) ? report.findings : [];

  return (
    <article className={`agent-report ${report.status}`}>
      <div>
        <strong>{report.role}</strong>
        <span>{report.status}</span>
      </div>
      <p>{report.summary}</p>
      {report.error ? <p className="error">{report.error}</p> : null}
      <ResearchProcess report={report} />
      <SourceCaptureList report={report} />
      <div className="agent-log-block">
        <h4>搜索日志</h4>
        <div className="agent-log-list">
          {searchLogs.map((log, index) => (
            <article className={`agent-log ${log.status}`} key={`${log.provider}-${log.engine ?? "default"}-${log.query}-${index}`}>
              <div>
                <strong>{formatSearchProvider(log.provider, log.engine)}</strong>
                <span>{log.status}</span>
              </div>
              <code>{log.query}</code>
              {log.message ? <small>{log.message}</small> : null}
              {log.results.length > 0 ? (
                <ol>
                  {log.results.slice(0, 5).map((result) => (
                    <li key={result.url}>
                      <a href={result.url} rel="noreferrer" target="_blank">
                        {result.title}
                      </a>
                      <small>{result.snippet}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <small>没有返回可用结果</small>
              )}
            </article>
          ))}
          {searchLogs.length > 0 && !searchLogs.some((log) => log.provider === "opencli") ? (
            <article className="agent-log not-called">
              <div>
                <strong>opencli</strong>
                <span>not_called</span>
              </div>
              <small>relay 或前置 provider 已返回可用结果，未触发 OpenCLI fallback。</small>
            </article>
          ) : null}
          {searchLogs.length === 0 ? <p className="muted">暂无搜索日志。</p> : null}
        </div>
      </div>
      <div className="agent-log-block">
        <h4>网页读取</h4>
        <div className="agent-log-list">
          {readLogs.map((log, index) => (
            <article className={`agent-log ${log.status}`} key={`${log.provider}-${log.url}-${index}`}>
              <div>
                <strong>{log.provider}</strong>
                <span>{log.status}</span>
              </div>
              <a href={log.url} rel="noreferrer" target="_blank">
                {log.title}
              </a>
              {typeof log.readCharCount === "number" ? <small>读取 {log.readCharCount} 字符</small> : null}
              {log.message ? <small>{log.message}</small> : null}
            </article>
          ))}
          {readLogs.length === 0 ? <p className="muted">暂无网页读取日志。</p> : null}
        </div>
      </div>
      <ul>
        {findings.map((finding) => (
          <li key={finding.claim}>
            <span>{finding.support}</span>
            {finding.claim}
          </li>
        ))}
      </ul>
    </article>
  );
}

function ResearchProcess({ report }: { report: ResearchRun["agentReports"][number] }) {
  const researchSteps = Array.isArray(report.researchSteps) ? report.researchSteps.filter(isRenderableResearchStep) : [];

  return (
    <div className="research-process">
      <h4>研究过程</h4>
      {researchSteps.length > 0 ? (
        <div className="research-step-list">
          {researchSteps.map((step, stepIndex) => (
            <article className="research-step" key={`${step.id}-${stepIndex}`}>
              <div className="research-step-head">
                <strong>{step.title}</strong>
                <span>{typeof step.round === "number" ? `Round ${step.round}` : step.type}</span>
              </div>
              <p>{step.detail}</p>
              {step.reason ? <small>{step.reason}</small> : null}
              {Array.isArray(step.queries) && step.queries.length > 0 ? (
                <ul className="query-list">
                  {step.queries.map((query, queryIndex) => (
                    <li key={`${step.id}-query-${queryIndex}-${query}`}>
                      <code>{query}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
              {Array.isArray(step.selectedUrls) && step.selectedUrls.length > 0 ? (
                <ul className="selected-url-list">
                  {step.selectedUrls.map((url, urlIndex) => (
                    <li key={`${step.id}-url-${urlIndex}-${url}`}>
                      <a href={url} rel="noreferrer" target="_blank">
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="research-step-meta">
                {step.decision ? <span>{step.decision}</span> : null}
                {step.provider ? <span>provider: {formatSearchProvider(step.provider, step.engine)}</span> : null}
                {typeof step.resultCount === "number" ? <span>{step.resultCount} results</span> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">暂无研究过程日志。</p>
      )}
    </div>
  );
}

function SourceCaptureList({ report }: { report: ResearchRun["agentReports"][number] }) {
  const sources = Array.isArray(report.sources) ? report.sources : [];

  return (
    <div className="captured-sources">
      <h4>抓到的网页</h4>
      {sources.map((source) => (
        <article key={source.url}>
          <div>
            <strong>{source.title}</strong>
            <span>{formatSearchProvider(source.provider, source.engine)}</span>
          </div>
          <a href={source.url} rel="noreferrer" target="_blank">
            {source.url}
          </a>
          <p>{source.fullText ?? source.snippet}</p>
        </article>
      ))}
      {sources.length === 0 ? <p className="muted">这个 Agent 没有抓到可用网页。</p> : null}
    </div>
  );
}

function isRenderableResearchStep(
  step: ResearchRun["agentReports"][number]["researchSteps"][number]
): step is ResearchRun["agentReports"][number]["researchSteps"][number] {
  return Boolean(step?.id && step.title && step.type && step.detail);
}

function formatSearchProvider(provider: string, engine?: string): string {
  return engine ? `${provider} · ${engine}` : provider;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "排队",
    running: "运行中",
    completed: "完成",
    failed: "失败"
  };
  return labels[status] ?? status;
}

function formatElapsed(start?: string, end?: string): string {
  if (!start) {
    return "-";
  }
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
