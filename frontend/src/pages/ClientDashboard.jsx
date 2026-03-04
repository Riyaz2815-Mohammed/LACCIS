import { useState, useEffect } from 'react';
import Layout from '../layouts/Layout';
import DocumentsTable from '../components/DocumentsTable';
import FromLegalTable from '../components/FromLegalTable';
import UploadArea from '../components/UploadArea';
import Modal from '../components/Modal';
import WorkspaceTabs from '../components/WorkspaceTabs';
import ChatBox from '../components/ChatBox';
import StatusBadge from '../components/StatusBadge';
import ActivityList from '../components/ActivityList';
import './Dashboard.css';
import './ClientWorkspace.css';

const API_URL = 'http://localhost:8000';

function ClientDashboard({ user, onLogout }) {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('documents');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadType, setUploadType] = useState('Others');
    const [legalTeam, setLegalTeam] = useState([]);
    const [selectedRecipient, setSelectedRecipient] = useState(null);
    const [sharedContracts, setSharedContracts] = useState([]);
    const [sharedLoading, setSharedLoading] = useState(false);
    const [activities, setActivities] = useState([]);
    const [activitiesLoading, setActivitiesLoading] = useState(false);

    const loadDocuments = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/documents/list`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok) {
                setDocuments(data.documents);
            }
        } catch (error) {
            console.error('Error loading documents:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadLegalTeam = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/legal/list`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok) {
                setLegalTeam(data.members || []);
                if (data.members && data.members.length > 0) {
                    setSelectedRecipient(data.members[0]);
                }
            }
        } catch (error) {
            console.error('Error loading legal team:', error);
        }
    };

    const loadSharedContracts = async () => {
        setSharedLoading(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/contracts/from-legal`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok) {
                setSharedContracts(data.contracts || []);
            }
        } catch (error) {
            console.error('Error loading shared contracts:', error);
        } finally {
            setSharedLoading(false);
        }
    };

    const loadActivities = async () => {
        setActivitiesLoading(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/activity/list`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok) {
                setActivities(data.activities || []);
            }
        } catch (error) {
            console.error('Error loading activities:', error);
        } finally {
            setActivitiesLoading(false);
        }
    };

    useEffect(() => {
        loadDocuments();
        loadLegalTeam();
        loadActivities();
    }, []);

    // Load shared contracts when From Legal tab is selected
    useEffect(() => {
        if (activeTab === 'from-legal') {
            loadSharedContracts();
        }
    }, [activeTab]);

    const handleUploadClick = (type) => {
        setUploadType(type);
        setShowUploadModal(true);
    };

    const handleUploadComplete = () => {
        setShowUploadModal(false);
        loadDocuments();
        loadActivities();
        setActiveTab('documents');
    };

    const handleAcceptContract = async (contractId) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/contracts/accept/${contractId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                loadSharedContracts();
                loadActivities();
                // Optionally reload user to get updated nda_accepted status
                loadDocuments();
            }
        } catch (err) {
            console.error('Accept contract error:', err);
        }
    };

    const handleRejectContract = async (contractId) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/contracts/reject/${contractId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                loadSharedContracts();
                loadActivities();
            }
        } catch (err) {
            console.error('Reject contract error:', err);
        }
    };

    return (
        <Layout user={user} onLogout={onLogout} pageTitle="Client Portal">
            <div className="workspace-container">
                <div className="workspace-header">
                    <div className="client-summary-card">
                        <div className="client-overview">
                            <div className="client-avatar-large">{user.name.charAt(0)}</div>
                            <div className="client-info">
                                <h1>Welcome, {user.name}</h1>
                                <p>Client Portal - Manage your legal documents and communication</p>
                                <div className="client-badges">
                                    <StatusBadge status="Active User" />
                                    <span className="info-badge">Portal Access: Enabled</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="workspace-main">
                    <WorkspaceTabs activeTab={activeTab} onTabChange={setActiveTab} showFromLegalTab={true} />

                    <div className="tab-content">
                        {activeTab === 'documents' && (
                            <div className="documents-section">
                                <div className="section-actions">
                                    <h2>Your Documents</h2>
                                    <div className="header-buttons">
                                        <button className="btn-workspace" onClick={() => handleUploadClick('Redlined')}>
                                            Upload Redlined
                                        </button>
                                        <button className="btn-workspace" onClick={() => handleUploadClick('Others')}>
                                            Upload New
                                        </button>
                                    </div>
                                </div>

                                <div className="workspace-card">
                                    <DocumentsTable
                                        documents={documents}
                                        loading={loading}
                                        currentUser={user}
                                        hideActions={true}
                                    />
                                </div>
                            </div>
                        )}

                        {activeTab === 'from-legal' && (
                            <div className="documents-section">
                                <div className="section-actions">
                                    <h2>Contracts Shared by Legal</h2>
                                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
                                        Contracts sent to you by the legal team
                                    </p>
                                </div>
                                <div className="workspace-card">
                                    <FromLegalTable
                                        contracts={sharedContracts}
                                        loading={sharedLoading}
                                        onAccept={handleAcceptContract}
                                        onReject={handleRejectContract}
                                    />
                                </div>
                            </div>
                        )}

                        {activeTab === 'chat' && (
                            <div className="chat-section">
                                <div className="section-actions">
                                    <h2>Legal Support Chat</h2>
                                    <p>Direct communication with your legal advisors</p>
                                </div>
                                <div className="chat-interface-v2">
                                    <div className="contacts-sidebar">
                                        <div className="sidebar-header">
                                            <h3>Contacts</h3>
                                        </div>
                                        <div className="contacts-list">
                                            {legalTeam.map((member) => (
                                                <div
                                                    key={member.id}
                                                    className={`contact-item ${selectedRecipient?.id === member.id ? 'active' : ''}`}
                                                    onClick={() => setSelectedRecipient(member)}
                                                >
                                                    <div className="contact-avatar">{member.name.charAt(0)}</div>
                                                    <div className="contact-info">
                                                        <div className="contact-name">{member.name}</div>
                                                        <div className="contact-role">Legal Team</div>
                                                    </div>
                                                </div>
                                            ))}
                                            {legalTeam.length === 0 && (
                                                <div className="contact-empty">No contacts found</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="chat-main">
                                        {selectedRecipient ? (
                                            <>
                                                <div className="chat-recipient-header">
                                                    <div className="recipient-avatar">{selectedRecipient.name.charAt(0)}</div>
                                                    <div className="recipient-details">
                                                        <h4>{selectedRecipient.name}</h4>
                                                        <span>Direct Message</span>
                                                    </div>
                                                </div>
                                                <ChatBox currentUser={user} recipientId={selectedRecipient.id} />
                                            </>
                                        ) : (
                                            <div className="chat-placeholder">
                                                <div className="placeholder-icon">💬</div>
                                                <p>Select a contact to start messaging</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'activity' && (
                            <div className="activity-section">
                                <div className="section-actions">
                                    <h2>Activity Timeline</h2>
                                    <p>Track history of uploads and status changes</p>
                                </div>
                                <div className="activity-log workspace-card">
                                    <ActivityList activities={activities} loading={activitiesLoading} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Modal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)}>
                <h2 style={{ color: 'white', marginBottom: '1.5rem' }}>Upload {uploadType}</h2>
                <UploadArea onUploadComplete={handleUploadComplete} documentType={uploadType} />
            </Modal>
        </Layout>
    );
}

export default ClientDashboard;
