'use client';

import React, { useEffect, useState } from 'react';
import type { ArchitectureNode } from '@/lib/hub/architecture-model';
import { CATEGORIES } from '@/lib/hub/architecture-data';
import { ArrowRightIcon, FileTextIcon, XIcon } from './icons';

interface NodeInspectorProps {
  node: ArchitectureNode | null;
  allNodes: ArchitectureNode[];
  onClose: () => void;
  onSelectNode: (node: ArchitectureNode) => void;
}

type InspectorTab =
  'overview' | 'relationships' | 'example' | 'technical' | 'history';

export function NodeInspector({
  node,
  allNodes,
  onClose,
  onSelectNode,
}: NodeInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');

  // Reset tab to overview when node changes
  useEffect(() => {
    setActiveTab('overview');
  }, [node?.id]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!node) return null;

  const categoryMeta = CATEGORIES[node.category];
  const isPlanned = node.status === 'planned';

  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const inputNodes = node.relationships.inputs
    .map((id) => nodeMap.get(id))
    .filter((n): n is ArchitectureNode => Boolean(n));
  const outputNodes = node.relationships.outputs
    .map((id) => nodeMap.get(id))
    .filter((n): n is ArchitectureNode => Boolean(n));

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-zinc-200/90 bg-white/95 shadow-2xl backdrop-blur-xl transition-all duration-300 dark:border-zinc-800 dark:bg-zinc-950/95 sm:w-[380px] sm:max-w-[400px]"
      aria-label="Node Inspector"
    >
      {/* Top Header */}
      <div className="flex items-start justify-between border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: categoryMeta.colorDark }}
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {categoryMeta.name}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                isPlanned
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isPlanned ? 'PLANNED — NOT IMPLEMENTED' : 'IMPLEMENTED'}
            </span>
          </div>

          <h2 className="mt-1 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {node.name}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {node.shortDescription}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="Close inspector (Esc)"
          aria-label="Close inspector"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="scrollbar-none flex overflow-x-auto border-b border-zinc-200/80 px-5 dark:border-zinc-800/80">
        {[
          { id: 'overview' as InspectorTab, label: 'Overview' },
          {
            id: 'relationships' as InspectorTab,
            label: `Relationships (${inputNodes.length + outputNodes.length})`,
          },
          { id: 'example' as InspectorTab, label: 'Example' },
          { id: 'technical' as InspectorTab, label: 'Technical' },
          { id: 'history' as InspectorTab, label: 'History' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px mr-4 whitespace-nowrap border-b-2 py-2.5 text-xs font-medium transition ${
              activeTab === tab.id
                ? 'border-indigo-600 font-semibold text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content Body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                What is this?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {node.overview.plainEnglish}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Why does Encore need it?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {node.overview.whyEncoreNeedsIt}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                What does it do?
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {node.overview.whatItDoes}
              </p>
            </div>

            {/* Authoritative Documentation Link */}
            <div className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                Authoritative Specification:
              </span>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                <FileTextIcon className="h-3.5 w-3.5" />
                <span>{node.technical.docReference}</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RELATIONSHIPS */}
        {activeTab === 'relationships' && (
          <div className="space-y-5">
            {/* Upstream Inputs */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Upstream Inputs ({inputNodes.length})
              </h3>
              <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                Components and observations that feed into this node:
              </p>
              {inputNodes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800">
                  None (root boundary or external ingress).
                </div>
              ) : (
                <div className="space-y-1.5">
                  {inputNodes.map((input) => (
                    <button
                      key={input.id}
                      type="button"
                      onClick={() => onSelectNode(input)}
                      className="group flex w-full items-center justify-between rounded-lg border border-zinc-200/80 bg-zinc-50/60 p-2.5 text-left text-xs transition hover:border-indigo-500 hover:bg-indigo-50/20 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-indigo-500"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              CATEGORIES[input.category].colorDark,
                          }}
                        />
                        <span className="font-medium text-zinc-900 group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-indigo-400">
                          {input.name}
                        </span>
                      </div>
                      <ArrowRightIcon className="h-3.5 w-3.5 text-zinc-400 group-hover:text-indigo-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Downstream Outputs */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Downstream Outputs ({outputNodes.length})
              </h3>
              <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                Components and tables that consume data from this node:
              </p>
              {outputNodes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800">
                  None (terminal surface or audit log).
                </div>
              ) : (
                <div className="space-y-1.5">
                  {outputNodes.map((output) => (
                    <button
                      key={output.id}
                      type="button"
                      onClick={() => onSelectNode(output)}
                      className="group flex w-full items-center justify-between rounded-lg border border-zinc-200/80 bg-zinc-50/60 p-2.5 text-left text-xs transition hover:border-indigo-500 hover:bg-indigo-50/20 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-indigo-500"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              CATEGORIES[output.category].colorDark,
                          }}
                        />
                        <span className="font-medium text-zinc-900 group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-indigo-400">
                          {output.name}
                        </span>
                      </div>
                      <ArrowRightIcon className="h-3.5 w-3.5 text-zinc-400 group-hover:text-indigo-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Architectural Rationale */}
            {node.relationships.rationale && (
              <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Rationale:{' '}
                </span>
                {node.relationships.rationale}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: EXAMPLE */}
        {activeTab === 'example' && (
          <div className="space-y-4">
            {node.example ? (
              <>
                <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-4 dark:border-indigo-950 dark:bg-indigo-950/20">
                  <h3 className="text-xs font-bold text-indigo-900 dark:text-indigo-300">
                    {node.example.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                    Scenario: {node.example.scenario}
                  </p>
                </div>

                <div className="space-y-3 font-mono text-xs">
                  <div>
                    <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Sample Input:
                    </span>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-100/70 p-3 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200">
                      {node.example.input}
                    </pre>
                  </div>

                  <div>
                    <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Sample Output:
                    </span>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-100/70 p-3 text-emerald-800 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-emerald-300">
                      {node.example.output}
                    </pre>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-200">
                    Explanation:{' '}
                  </span>
                  {node.example.explanation}
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-zinc-200 p-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
                Detailed scenario example will be populated in subsequent phase
                milestones.
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TECHNICAL */}
        {activeTab === 'technical' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Technical Summary
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {node.technical.summary}
              </p>
            </div>

            {/* Relevant Repository Files */}
            {node.technical.relevantFiles &&
              node.technical.relevantFiles.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Repository Implementation Files
                  </h3>
                  <div className="space-y-1 font-mono text-xs">
                    {node.technical.relevantFiles.map((file) => (
                      <div
                        key={file}
                        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                      >
                        <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                        <span className="truncate">{file}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Relevant Database Tables */}
            {node.technical.tableNames &&
              node.technical.tableNames.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    PostgreSQL Tables & Schemas
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {node.technical.tableNames.map((table) => (
                      <span
                        key={table}
                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                      >
                        public.{table}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            {/* Key Functions / Procedures */}
            {node.technical.keyFunctions &&
              node.technical.keyFunctions.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Stored Procedures / Key Functions
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {node.technical.keyFunctions.map((fn) => (
                      <span
                        key={fn}
                        className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-mono text-xs font-medium text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300"
                      >
                        {fn}
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* TAB 5: HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Introduced Milestone
              </h3>
              <p className="mt-1 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {node.history?.introducedInPhase || 'Phase 0'}
              </p>
            </div>

            {node.history?.decisionRef && (
              <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Architectural Decision Reference
                </h3>
                <p className="mt-1 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                  {node.history.decisionRef}
                </p>
              </div>
            )}

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Design Evolution & Rationale
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {node.history?.rationale ||
                  'Established during early architecture planning to preserve provenance and system boundaries.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
