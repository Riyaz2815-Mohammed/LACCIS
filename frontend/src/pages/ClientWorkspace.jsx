import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../layouts/Layout';
import WorkspaceTabs from '../components/WorkspaceTabs';
import ChatBox from '../components/ChatBox';
import DocumentsTable from '../components/DocumentsTable';
import SentByLegalTable from '../components/SentByLegalTable';
import StatusBadge from '../components/StatusBadge';
import ActivityList from '../components/ActivityList';
import './ClientWorkspace.css';
import { apiFetch } from '../utils/api';

const ClientWorkspace = ({ user, onLogout }) => {
    const { clientId } = useParams();
    const navigate = useNavigate();
    const [client, setClient] = useState(null);
    const [activeTab, setActiveTab] = useState('documents');
    const [documents, setDocuments] = useState([]);
    const [legalSentDocs, setLegalSentDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activities, setActivities] = useState([]);
    const [activitiesLoading, setActivitiesLoading] = useState(false);

    // Share tab state
    const [shareFile, setShareFile] = useState(null);
    const [shareMessage, setShareMessage] = useState('');
    const [shareDragging, setShareDragging] = useState(false);
    const [shareLoading, setShareLoading] = useState(false);
    const [shareSuccess, setShareSuccess] = useState('');
    const [shareError, setShareError] = useState('');
    const [selectedContractType, setSelectedContractType] = useState('NDA');
    const [isFinalized, setIsFinalized] = useState(false);
    const fileInputRef = useRef(null);

    const loadData = async () => {
        try {
            const [clientsRes, docsRes] = await Promise.all([
                apiFetch('/api/clients/list'),
                apiFetch('/api/documents/list'),
            ]);

            const clientsData = await clientsRes.json();
            const docsData = await docsRes.json();
            const legalDocsData = await legalDocsRes.json();

            if (clientsRes.ok && docsRes.ok && legalDocsRes.ok) {
                const currentClient = clientsData.clients.find(c => c.id === clientId);
                if (!currentClient) {
                    navigate('/dashboard');
                    return;
                }
                setClient(currentClient);
                const allClientDocs = docsData.documents.filter(d =>
                    d.user_id === clientId ||
                    (d.shared_with && d.shared_with.includes(clientId))
                );
                // Set client-uploaded docs (exclude legal uploads if any are still in there)
                setDocuments(allClientDocs.filter(d => d.user_role !== 'legal_team' && d.user_role !== 'admin'));

                // Set explicitly shared legal documents
                setLegalSentDocs(legalDocsData.contracts || []);
            }
        } catch (error) {
            console.error('Error loading workspace data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadActivities = async () => {
        setActivitiesLoading(true);
        try {
            const res = await apiFetch('/api/activity/list?client_id=${clientId}');
            const data = await res.json();
            if (res.ok) setActivities(data.activities);
        } catch (err) {
            console.error('Error loading activities:', err);
        } finally {
            setActivitiesLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        loadActivities();
    }, [clientId]);

    const handleApprove = async (docId) => {
        try {
            const res = await apiFetch('/api/documents/approve/${docId}', {
                method: 'POST',
            });
            if (res.ok) {
                loadData();
                loadActivities();
            }
            else console.error('Approve failed');
        } catch (err) {
            console.error('Approve error:', err);
        }
    };

    const handleReject = async (docId) => {
        try {
            const res = await apiFetch('/api/documents/reject/${docId}', {
                method: 'POST',
            });
            if (res.ok) {
                loadData();
                loadActivities();
            }
            else console.error('Reject failed');
        } catch (err) {
            console.error('Reject error:', err);
        }
    };

    const handleFinalize = async (docId) => {
        try {
            const res = await apiFetch('/api/documents/finalize/${docId}', {
                method: 'POST',
            });
            if (res.ok) {
                loadData();
                loadActivities();
            }
            else console.error('Finalize failed');
        } catch (err) {
            console.error('Finalize error:', err);
        }
    };

    const handleDownload = async (docId) => {
        try {
            const res = await apiFetch('/api/documents/download/${docId}');
            const data = await res.json();
            if (data.download_url) {
                window.open(data.download_url, '_blank');
            }
        } catch (err) {
            console.error('Download error:', err);
        }
    };

    // Share tab handlers
    const validateFile = (file) => {
        if (!file) return 'Please select a file.';
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'docx'].includes(ext)) return 'Only PDF and DOCX files are allowed.';
        if (file.size > 10 * 1024 * 1024) return 'File size must be under 10MB.';
        return null;
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setShareDragging(false);
        const file = e.dataTransfer.files[0];
        const err = validateFile(file);
        if (err) { setShareError(err); return; }
        setShareError('');
        setShareFile(file);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        const err = validateFile(file);
        if (err) { setShareError(err); return; }
        setShareError('');
        setShareFile(file);
    };

    const handleSendToClient = async () => {
        const err = validateFile(shareFile);
        if (err) { setShareError(err); return; }

        setShareLoading(true);
        setShareError('');
        setShareSuccess('');

        try {
            const formData = new FormData();
            formData.append('file', shareFile);
            formData.append('client_id', clientId);
            formData.append('document_type', selectedContractType);
            formData.append('is_final', isFinalized);
            if (shareMessage.trim()) formData.append('message', shareMessage.trim());

            const res = await apiFetch('/api/contracts/share-with-client', {
                method: 'POST',
                headers: {},
                body: formData,
            });
            const data = await res.json();
            if (res.ok) {
                setShareSuccess(`✅ "${shareFile.name}" shared with ${client.name} successfully!`);
                setShareFile(null);
                setShareMessage('');
                if (fileInputRef.current) fileInputRef.current.value = '';
                loadActivities();
            } else {
                setShareError(data.detail || 'Failed to share contract.');
            }
        } catch (err) {
            console.error('Share error:', err);
            setShareError('Connection error. Please try again.');
        } finally {
            setShareLoading(false);
        }
    };

    const handleCancelShare = () => {
        setShareFile(null);
        setShareMessage('');
        setShareError('');
        setShareSuccess('');
        setIsFinalized(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    if (loading || !client) {
        return (
            <Layout user={user} onLogout={onLogout} pageTitle="Client Workspace">
                <div className="loading-workspace">Loading workspace...</div>
            </Layout>
        );
    }

    return (
        <Layout user={user} onLogout={onLogout} pageTitle="Client Workspace">
            <div className="workspace-container">
                <div className="workspace-header">
                    <div className="client-summary-card">
                        <div className="client-overview">
                            <div className="client-avatar-large">{client.name.charAt(0)}</div>
                            <div className="client-info">
                                <h1>{client.name}</h1>
                                <p>{client.email}</p>
                                <div className="client-badges">
                                    <StatusBadge status="Active" />
                                    <span className="info-badge">Registered: {new Date(client.created_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                        <div className="client-stats-mini">
                            <div className="mini-stat">
                                <span className="stat-label">Documents</span>
                                <span className="stat-value">{documents.length}</span>
                            </div>
                            <div className="mini-stat">
                                <span className="stat-label">Pending</span>
                                <span className="stat-value text-warning">
                                    {documents.filter(d => d.status === 'pending' || d.status === 'uploaded').length}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="workspace-main">
                    <WorkspaceTabs activeTab={activeTab} onTabChange={setActiveTab} showShareTab={true} />

                    <div className="tab-content">
                        {activeTab === 'documents' && (
                            <div className="documents-section">
                                <div className="section-actions">
                                    <h2>Client Documents</h2>
                                </div>
                                <div className="workspace-card">
                                    <DocumentsTable
                                        documents={documents}
                                        loading={false}
                                        currentUser={user}
                                        onApprove={handleApprove}
                                        onReject={handleReject}
                                        onDownload={handleDownload}
                                        onFinalize={handleFinalize}
                                    />
                                </div>

                                {/* Documents sent by the legal team to this client */}
                                <div className="section-actions" style={{ marginTop: '2.5rem' }}>
                                    <h2>Documents Sent by You</h2>
                                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
                                        Contracts and documents you shared with this client
                                    </p>
                                </div>
                                <div className="workspace-card" style={{ marginTop: '1rem' }}>
                                    <SentByLegalTable
                                        documents={legalSentDocs}
                                        loading={false}
                                        onFinalize={handleFinalize}
                                    />
                                </div>
                            </div>
                        )}

                        {activeTab === 'chat' && (
                            <div className="chat-section">
                                <div className="section-actions">
                                    <h2>Direct Messaging</h2>
                                    <p>Real-time updates with {client.name}</p>
                                </div>
                                <ChatBox currentUser={user} recipientId={clientId} />
                            </div>
                        )}

                        {activeTab === 'activity' && (
                            <div className="activity-section">
                                <div className="section-actions">
                                    <h2>Activity Log</h2>
                                    <p>History of all actions in this workspace</p>
                                </div>
                                <div className="activity-log workspace-card">
                                    <ActivityList activities={activities} loading={activitiesLoading} />
                                </div>
                            </div>
                        )}

                        {activeTab === 'share' && (
                            <div className="share-section">
                                <div className="section-actions">
                                    <h2>Share Contract with Client</h2>
                                    <p>Upload a contract to share directly with <strong>{client.name}</strong></p>
                                </div>

                                <div className="workspace-card share-card">
                                    {/* Contract Type Dropdown */}
                                    <div className="share-notes-section" style={{ marginBottom: '1.5rem' }}>
                                        <label className="share-label">Select Contract Type</label>
                                        <select
                                            className="share-textarea"
                                            style={{ height: 'auto', padding: '0.75rem' }}
                                            value={selectedContractType}
                                            onChange={(e) => setSelectedContractType(e.target.value)}
                                        >
                                            <option value="NDA">NDA</option>
                                            <option value="RA">RA</option>
                                            <option value="SOW">SOW</option>
                                            <option value="MSA">MSA</option>
                                            <option value="Vendor Agreement">Vendor Agreement</option>
                                        </select>
                                    </div>

                                    {/* Drag & Drop Area */}
                                    <div
                                        className={`share-dropzone${shareDragging ? ' dragging' : ''}${shareFile ? ' has-file' : ''}`}
                                        onDragOver={(e) => { e.preventDefault(); setShareDragging(true); }}
                                        onDragLeave={() => setShareDragging(false)}
                                        onDrop={handleDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".pdf,.docx"
                                            style={{ display: 'none' }}
                                            onChange={handleFileSelect}
                                        />
                                        {shareFile ? (
                                            <div className="share-file-preview">
                                                <span className="share-file-icon">
                                                    {shareFile.name.endsWith('.pdf') ? '📄' : '📝'}
                                                </span>
                                                <div className="share-file-info">
                                                    <span className="share-file-name">{shareFile.name}</span>
                                                    <span className="share-file-size">
                                                        {(shareFile.size / 1024).toFixed(1)} KB
                                                    </span>
                                                </div>
                                                <button
                                                    className="share-file-remove"
                                                    onClick={(e) => { e.stopPropagation(); handleCancelShare(); }}
                                                    title="Remove file"
                                                >×</button>
                                            </div>
                                        ) : (
                                            <div className="share-dropzone-placeholder">
                                                <p className="share-drop-text">Drag & drop your file here</p>
                                                <p className="share-drop-sub">or</p>
                                                <button className="btn-browse" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                                                    Browse File
                                                </button>
                                                <p className="share-format-hint">Allowed: PDF, DOCX &nbsp;·&nbsp; Max size: 10MB</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Notes Textarea */}
                                    <div className="share-notes-section">
                                        <label className="share-label">Message / Notes <span className="optional-label">(Optional)</span></label>
                                        <textarea
                                            className="share-textarea"
                                            rows={4}
                                            placeholder="Add any notes or instructions for the client..."
                                            value={shareMessage}
                                            onChange={(e) => setShareMessage(e.target.value)}
                                        />
                                    </div>

                                    {/* Finalize Checkbox */}
                                    <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                        <input
                                            type="checkbox"
                                            id="isFinalCheckboxShare"
                                            checked={isFinalized}
                                            onChange={(e) => setIsFinalized(e.target.checked)}
                                            style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                                        />
                                        <label htmlFor="isFinalCheckboxShare" style={{ fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                                            Mark as Final Document
                                        </label>
                                    </div>

                                    {/* Feedback */}
                                    {shareError && <div className="share-alert share-alert-error"> {shareError}</div>}
                                    {shareSuccess && <div className="share-alert share-alert-success">{shareSuccess}</div>}

                                    {/* Action Buttons */}
                                    <div className="share-actions">
                                        <button
                                            className="btn-send-client"
                                            onClick={handleSendToClient}
                                            disabled={shareLoading || !shareFile}
                                        >
                                            {shareLoading ? 'Sending...' : ' Send to Client'}
                                        </button>
                                        <button
                                            className="btn-cancel-share"
                                            onClick={handleCancelShare}
                                            disabled={shareLoading}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default ClientWorkspace;