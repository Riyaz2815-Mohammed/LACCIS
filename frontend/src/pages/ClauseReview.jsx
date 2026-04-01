import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../layouts/Layout';
import DocumentChatbot from '../components/DocumentChatbot';
import ReactMarkdown from 'react-markdown';
import './ClauseReview.css';
import { apiFetch } from '../utils/api';

/* ── Colour helpers ──────────────────────────────────────────── */
const CLAUSE_COLORS = {
    'Header': '#7c3aed',
    'Indemnity': '#ef4444',
    'Limitation of Liability': '#f59e0b',
    'Confidentiality': '#3b82f6',
    'Termination': '#ec4899',
    'Payment Terms': '#10b981',
    'SLA': '#6366f1',
    'Governing Law': '#8b5cf6',
    'Force Majeure': '#f97316',
    'Intellectual Property': '#06b6d4',
    'Warranty': '#84cc16',
    'Data Protection': '#0ea5e9',
    'Other': '#64748b',
};

const RISK_CONFIG = {
    High: { class: 'high', icon: '🔴', barColor: '#ef4444' },
    Medium: { class: 'medium', icon: '🟡', barColor: '#f59e0b' },
    Low: { class: 'low', icon: '🟢', barColor: '#10b981' },
};

const normalizeRisk = (r) => {
    if (!r) return 'High';
    return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
};

/* ── Suggestion diff preview helper (Granular) ───────────────── */
function buildSuggestionPreviewHtml(original, suggested, changeType) {
    if (changeType === 'insert') return `<ins class="tc-ins">${suggested}</ins>`;
    if (changeType === 'delete') return `<del class="tc-del">${original}</del>`;

    // Replace: Use granular diff to avoid striking out whole clause
    if (!original) return `<ins class="tc-ins">${suggested}</ins>`;
    if (!suggested) return `<del class="tc-del">${original}</del>`;

    const a = original.split(/(\s+)/);
    const b = suggested.split(/(\s+)/);

    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let j = 0;
    while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;

    const prefix = a.slice(0, i).join('');
    const suffix = a.slice(a.length - j).join('');
    const delText = a.slice(i, a.length - j).join('');
    const insText = b.slice(i, b.length - j).join('');

    let mid = "";
    if (delText) mid += `<del class="tc-del">${delText}</del>`;
    if (insText) mid += `<ins class="tc-ins">${insText}</ins>`;

    return prefix + mid + suffix;
}

export default function ClauseReview({ user, onLogout }) {
    const { documentId } = useParams();
    const navigate = useNavigate();

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sendingRedline, setSendingRedline] = useState(false);
    const [redlineMsg, setRedlineMsg] = useState('');

    const [activeTab, setActiveTab] = useState('All');
    const [selectedClauseId, setSelectedClauseId] = useState(null);

    // Suggestion mode states
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [suggestionDraft, setSuggestionDraft] = useState('');

    // Comment states (kept)
    const [isCommenting, setIsCommenting] = useState(false);
    const [commentValue, setCommentValue] = useState('');

    // LLM state
    const [llmLoading, setLlmLoading] = useState(false);
    const [llmAnswer, setLlmAnswer] = useState('');

    // Action loading per suggestion id  { [sugId]: true|false }
    const [sugActionLoading, setSugActionLoading] = useState({});
    // Global action loading
    const [actionLoading, setActionLoading] = useState(false);

    const fetchReview = useCallback(async () => {
        try {
            const res = await apiFetch('/api/documents/review/${documentId}');
            const result = await res.json();
            if (res.ok) {
                setData(result);
                return result.status;
            } else {
                setError(result.detail || 'Failed to load review');
            }
        } catch (err) {
            setError('Connection error');
        } finally {
            setLoading(false);
        }
        return null;
    }, [documentId]);

    const isPollingRef = useRef(false);

    const counts = useMemo(() => {
        const clauses = data?.clauses || [];
        return clauses.reduce((acc, c) => {
            const r = normalizeRisk(c.risk);
            acc[r] = (acc[r] || 0) + 1;
            return acc;
        }, {});
    }, [data]);

    const filteredClauses = useMemo(() => {
        const clauses = data?.clauses || [];
        return clauses.filter(c => {
            if (activeTab === 'All') return true;
            return normalizeRisk(c.risk) === activeTab;
        });
    }, [data, activeTab]);

    const selectedClause = useMemo(() => {
        return filteredClauses.find(c => c.content_id === selectedClauseId) || filteredClauses[0];
    }, [filteredClauses, selectedClauseId]);

    useEffect(() => {
        if (filteredClauses.length > 0 && selectedClauseId) {
            const exists = filteredClauses.some(c => c.content_id === selectedClauseId);
            if (!exists) setSelectedClauseId(filteredClauses[0].content_id);
        } else if (filteredClauses.length > 0 && !selectedClauseId) {
            setSelectedClauseId(filteredClauses[0].content_id);
        }
    }, [filteredClauses, selectedClauseId]);

    useEffect(() => {
        let isMounted = true;
        let pollTimer = null;
        const poll = async () => {
            if (!isMounted || isPollingRef.current) return;
            isPollingRef.current = true;
            const status = await fetchReview();
            isPollingRef.current = false;
            if (isMounted && status === 'processing') {
                pollTimer = setTimeout(poll, 5000);
            }
        };
        poll();
        return () => {
            isMounted = false;
            if (pollTimer) clearTimeout(pollTimer);
            isPollingRef.current = false;
        };
    }, [fetchReview]);

    if (loading) {
        return (
            <Layout user={user} onLogout={onLogout} pageTitle="Review">
                <div className="review-processing">
                    <div className="spinner" />
                    <p>Loading clause review…</p>
                </div>
            </Layout>
        );
    }

    if (error) {
        return (
            <Layout user={user} onLogout={onLogout} pageTitle="Review">
                <div className="review-processing">
                    <p style={{ color: '#f87171' }}>⚠️ {error}</p>
                    <button className="btn-back-review" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>
                        ← Go Back
                    </button>
                </div>
            </Layout>
        );
    }

    const doc = data?.document;
    const clauses = data?.clauses || [];
    const status = doc?.status || data?.status;
    const isProcessing = status === 'processing';

    if (isProcessing) {
        return (
            <Layout user={user} onLogout={onLogout} pageTitle="Review">
                <div className="review-processing" style={{ height: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="spinner" style={{ width: '40px', height: '40px', borderWidth: '4px', marginBottom: '1rem' }} />
                    <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Analyzing contract clauses...</h3>
                    <p style={{ color: 'var(--text-secondary)' }}>Extracting risk factors and comparing to standard library.</p>
                </div>
            </Layout>
        );
    }

    // --- Actions ---

    const handleAction = async (actionStr) => {
        if (!selectedClause) return;
        setActionLoading(true);
        try {
            await apiFetch('/api/documents/review/${documentId}/action', {
                method: 'POST',
                body: JSON.stringify({ content_id: selectedClause.content_id, action: actionStr }),
            });
            await fetchReview();
        } catch (err) {
            console.error('Action error', err);
        } finally {
            setActionLoading(false);
        }
    };

    /* ── Suggestion submit ─────────────────────────────────────── */
    const submitSuggestion = async () => {
        if (!selectedClause || !suggestionDraft.trim()) return;
        setActionLoading(true);
        try {
            const original = selectedClause.edited_content || selectedClause.content;
            await apiFetch('/api/documents/review/${documentId}/suggest', {
                method: 'POST',
            });
            setSuggestionDraft('');
            setIsSuggesting(false);
            await fetchReview();
        } catch (err) {
            console.error('Submit suggestion error', err);
        } finally {
            setActionLoading(false);
        }
    };

    /* ── Suggestion accept / reject ────────────────────────────── */
    const handleSuggestionAction = async (sugId, action) => {
        setSugActionLoading(prev => ({ ...prev, [sugId]: true }));
        try {
            await apiFetch('/api/documents/review/${documentId}/suggestion-action', {
                method: 'POST',
                body: JSON.stringify({ suggestion_id: sugId, action }),
            });
            await fetchReview();
        } catch (err) {
            console.error('Suggestion action error', err);
        } finally {
            setSugActionLoading(prev => ({ ...prev, [sugId]: false }));
        }
    };

    /* ── Comment save ──────────────────────────────────────────── */
    const saveComment = async () => {
        if (!selectedClause) return;
        setActionLoading(true);
        try {
            await apiFetch('/api/documents/review/${documentId}/comment', {
                method: 'POST',
                body: JSON.stringify({ content_id: selectedClause.content_id, comment: commentValue }),
            });
            await fetchReview();
            setIsCommenting(false);
        } catch (err) {
            console.error('Comment error', err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleAskLLM = async () => {
        if (!selectedClause) return;
        setLlmLoading(true);
        setLlmAnswer('');
        try {
            const res = await apiFetch('/api/documents/review/${documentId}/ask-llm', {
                method: 'POST',
            });
            const d = await res.json();
            setLlmAnswer(d.answer || d.detail || 'No response');
        } catch (err) {
            setLlmAnswer('⚠️ Connection error');
        } finally {
            setLlmLoading(false);
        }
    };

    const handleDownloadRedline = async () => {
        setActionLoading(true);
        try {
            const res = await apiFetch('/api/documents/download-redline-docs/${documentId}', {
                method: 'POST',
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to open Google Docs');
            }
            const data = await res.json();
            if (data.url) {
                window.open(data.url, '_blank');
            } else {
                throw new Error('No URL returned');
            }
        } catch (err) {
            console.error('Download redline error', err);
            alert(`Failed to open Redline in Google Docs: ${err.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleSendRedline = async () => {
        setSendingRedline(true);
        setRedlineMsg('');
        try {
            const res = await apiFetch('/api/documents/send-redline/${documentId}', {
                method: 'POST',
            });
            const d = await res.json();
            if (res.ok) {
                setRedlineMsg('✅ Redline sent to client!');
                setTimeout(() => setRedlineMsg(''), 3000);
            } else {
                throw new Error(d.detail || 'Failed to send');
            }
        } catch (err) {
            console.error('Send redline error', err);
            alert(`Failed to send redline: ${err.message}`);
        } finally {
            setSendingRedline(false);
        }
    };

    const startSuggesting = () => {
        if (!selectedClause) return;
        setSuggestionDraft(selectedClause.edited_content || selectedClause.content);
        setIsSuggesting(true);
    };

    const askAI = () => {
        const chatbotInput = document.querySelector('.chat-input textarea');
        if (chatbotInput) {
            chatbotInput.focus();
            chatbotInput.scrollIntoView({ behavior: 'smooth' });
        }
    };

    /* ── Pending suggestion count helper ───────────────────────── */
    const getPendingCount = (clause) => {
        return (clause.suggestions || []).filter(s => s.status === 'pending').length;
    };

    /* ── Render ─────────────────────────────────────────────────── */
    return (
        <Layout user={user} onLogout={onLogout} pageTitle="Clause Review">
            <div className="review-page master-detail-mode">

                {/* Header & Horizontal Clause Tabs */}
                <div className="md-header-redesign">
                    <div className="md-header-top">
                        <button className="md-btn-back" onClick={() => navigate(-1)}>← Back</button>
                        <h2>Contract Clause Review</h2>
                        <div className="md-risk-filters">
                            <button className={`filter-pill ${activeTab === 'All' ? 'active' : ''}`} onClick={() => setActiveTab('All')}>All ({data?.clauses?.length || 0})</button>
                            {counts.High > 0 && <button className={`filter-pill high ${activeTab === 'High' ? 'active' : ''}`} onClick={() => setActiveTab('High')}>High Risk ({counts.High})</button>}
                            {counts.Medium > 0 && <button className={`filter-pill medium ${activeTab === 'Medium' ? 'active' : ''}`} onClick={() => setActiveTab('Medium')}>Medium Risk ({counts.Medium})</button>}
                            {counts.Low > 0 && <button className={`filter-pill low ${activeTab === 'Low' ? 'active' : ''}`} onClick={() => setActiveTab('Low')}>Low Risk ({counts.Low})</button>}
                        </div>
                    </div>

                    <div className="md-horizontal-clauses larger-tabs">
                        {filteredClauses.map(c => {
                            const r = normalizeRisk(c.risk);
                            const isSelected = selectedClause && selectedClause.content_id === c.content_id;
                            const pendingCount = getPendingCount(c);
                            return (
                                <button
                                    key={c.content_id}
                                    className={`clause-tab ${isSelected ? 'active' : ''} risk-${r.toLowerCase()}`}
                                    onClick={() => {
                                        setSelectedClauseId(c.content_id);
                                        setLlmAnswer('');
                                        setIsSuggesting(false);
                                        setIsCommenting(false);
                                    }}
                                >
                                    <span className="tab-name">{c.clause_type}</span>
                                    <span className={`tab-risk-badge ${r.toLowerCase()}`}>{r} Risk</span>
                                    {pendingCount > 0 && <span className="tab-sug-badge">{pendingCount}</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="md-layout">
                    <div className="md-detail">
                        {!selectedClause ? (
                            <div className="detail-empty">Select a clause above to begin review.</div>
                        ) : (
                            <div className={`detail-card risk-${normalizeRisk(selectedClause.risk).toLowerCase()}`}>
                                <div className="detail-header">
                                    <div className="detail-title-area">
                                        <h3>{selectedClause.clause_type}</h3>
                                        <div className="detail-meta">
                                            <span>Page {selectedClause.page_number}</span>
                                        </div>
                                    </div>
                                    <div className="detail-status-area">
                                        <span className={`detail-risk-pill ${normalizeRisk(selectedClause.risk).toLowerCase()}`}>
                                            {normalizeRisk(selectedClause.risk)} Risk
                                        </span>
                                        <span className="detail-confidence">
                                            {Math.round((selectedClause.risk_confidence || selectedClause.similarity_score || 0) * 100)}% Confidence
                                        </span>
                                        {selectedClause.approval_status === 'approved' && (
                                            <span className="detail-approved-badge">Approved</span>
                                        )}
                                    </div>
                                </div>

                                <div className="comparison-box">
                                    <div className="comp-pane upload-pane">
                                        <div className="pane-title"> Uploaded Contract</div>
                                        <div className="pane-content">
                                            <div
                                                className="text-display"
                                                dangerouslySetInnerHTML={{ __html: selectedClause.html_diff || selectedClause.content }}
                                            />
                                        </div>
                                    </div>

                                    <div className="comp-pane standard-pane">
                                        <div className="pane-title"> Standard Clause</div>
                                        <div className="pane-content">
                                            {selectedClause.matched_clause ? (
                                                <div className="matched-clause-box">
                                                    <div className="matched-clause-name">{selectedClause.matched_clause.clause || selectedClause.clause_type}</div>
                                                    <div className="matched-clause-text">{selectedClause.matched_clause.content}</div>
                                                </div>
                                            ) : (
                                                <div className="no-match-box">No direct match found in standard library.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="ai-analysis-section">
                                    <div className="ai-analysis-box">
                                        <div className="ai-box-title">AI Analysis</div>
                                        <div className="ai-reasoning">
                                            {llmLoading ? (
                                                <div className="analysis-loading">
                                                    <div className="spinner-small" /> Analyzing risks...
                                                </div>
                                            ) : (
                                                (llmAnswer || selectedClause.llm_reasoning) ? (
                                                    <ReactMarkdown>
                                                        {llmAnswer || selectedClause.llm_reasoning}
                                                    </ReactMarkdown>
                                                ) : (
                                                    'Click the button below to run a detailed AI analysis of this clause, including risk factors and suggestions for improvement.'
                                                )
                                            )}
                                        </div>
                                        {!llmAnswer && (
                                            <button className="btn-run-analysis" onClick={handleAskLLM}>Run Detailed Analysis</button>
                                        )}
                                    </div>
                                </div>

                                {/* Suggestion Editor (Overlay-ish but inside detail) */}
                                {isSuggesting && (
                                    <div className="sug-editor-section">
                                        <h4>Suggest a Revision</h4>
                                        <textarea
                                            className="sug-textarea-v2"
                                            rows={12}
                                            value={suggestionDraft}
                                            onChange={(e) => setSuggestionDraft(e.target.value)}
                                            placeholder="Type your suggested changes here..."
                                        />
                                        <div className="sug-editor-actions">
                                            <button className="btn-submit-sug blue-pill" onClick={submitSuggestion} disabled={actionLoading}>
                                                {actionLoading ? <div className="spinner-small" /> : ' Submit Suggestion'}
                                            </button>
                                            <button className="btn-cancel-sug" onClick={() => setIsSuggesting(false)}>Cancel</button>
                                        </div>
                                    </div>
                                )}

                                {/* Suggestions list */}
                                {(selectedClause.suggestions || []).length > 0 && (
                                    <div className="suggestions-list-section">
                                        <div className="suggestions-list-title"> Suggestions</div>
                                        {(selectedClause.suggestions || []).map(sug => (
                                            <div key={sug.id} className={`suggestion-card status-${sug.status}`}>
                                                <div className="sug-card-meta">
                                                    <span className="sug-author"> {sug.author}</span>
                                                    <span className="sug-timestamp">
                                                        {sug.timestamp ? new Date(sug.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                                                    </span>
                                                    <span className={`sug-status-pill ${sug.status}`}>
                                                        {sug.status === 'pending' ? 'Pending' : sug.status === 'accepted' ? '✓ Accepted' : '✗ Rejected'}
                                                    </span>
                                                </div>
                                                <div
                                                    className="sug-diff-preview"
                                                    dangerouslySetInnerHTML={{
                                                        __html: buildSuggestionPreviewHtml(sug.original_text, sug.suggested_text, sug.change_type)
                                                    }}
                                                />
                                                {sug.status === 'pending' && (
                                                    <div className="sug-card-actions">
                                                        <button className="btn-accept-sug" disabled={sugActionLoading[sug.id]} onClick={() => handleSuggestionAction(sug.id, 'accept')}>
                                                            {sugActionLoading[sug.id] ? '…' : '✓ Accept'}
                                                        </button>
                                                        <button className="btn-reject-sug" disabled={sugActionLoading[sug.id]} onClick={() => handleSuggestionAction(sug.id, 'reject')}>
                                                            {sugActionLoading[sug.id] ? '…' : '✗ Reject'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="clause-comment-section">
                                    <div className="comment-label">Legal Note / Comment</div>
                                    {isCommenting ? (
                                        <div className="comment-mode-container">
                                            <textarea
                                                className="comment-input"
                                                value={commentValue}
                                                onChange={e => setCommentValue(e.target.value)}
                                                placeholder="Add a comment..."
                                            />
                                            <div className="edit-actions">
                                                <button className="btn-save blue-pill" onClick={saveComment}>Save Comment</button>
                                                <button className="btn-cancel" onClick={() => setIsCommenting(false)}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="clause-comment-display" onClick={() => { setCommentValue(selectedClause.comment || ''); setIsCommenting(true); }}>
                                            {selectedClause.comment ? (
                                                <p>{selectedClause.comment}</p>
                                            ) : (
                                                <span className="placeholder">Click to add a note or comment for the client...</span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="bottom-detail-actions">
                                    {!isSuggesting && (
                                        <button className="btn-action suggest-btn blue-pill-large" onClick={startSuggesting}>
                                            Suggest Edit
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Fixed Global Action Bar */}
                <div className="review-footer-fixed">
                    <div className="footer-left">
                        <div className="final-actions-group">
                            <button className="btn-footer primary" onClick={handleDownloadRedline} disabled={actionLoading}>
                                {actionLoading ? <span className="spinner-small" style={{ margin: '0 8px' }} /> : ' Download Redline'}
                            </button>
                            <button className="btn-footer primary" onClick={handleSendRedline} disabled={sendingRedline || actionLoading}>
                                {sendingRedline ? 'Sending...' : ' Send Redline to Client'}
                            </button>
                        </div>
                    </div>
                </div>

                <DocumentChatbot documentId={documentId} />

                {redlineMsg && <div className="redline-toast">{redlineMsg}</div>}
            </div>
        </Layout>
    );
}