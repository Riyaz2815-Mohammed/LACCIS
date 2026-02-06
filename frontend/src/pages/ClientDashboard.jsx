import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import DocumentsTable from '../components/DocumentsTable';
import UploadArea from '../components/UploadArea';
import Modal from '../components/Modal';
import '../pages/Dashboard.css'; // Reuse dashboard styles
import '../pages/Upload.css'; // Reuse upload styles for specific elements if needed

const API_URL = 'http://localhost:8000';

function ClientDashboard({ user, onLogout }) {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [uploadType, setUploadType] = useState('Others'); // 'Redlined' or 'Others'
    const [acceptLoading, setAcceptLoading] = useState(false);
    const [showAcceptSuccess, setShowAcceptSuccess] = useState(false);

    // Mock Assigned Contract Data
    const assignedContract = {
        title: "Service Agreement - Q1 2026",
        status: "Assigned",
        driveLink: "https://docs.google.com/document/u/0/?tgif=d", // Placeholder Google Drive Link
        assignedBy: "Legal Team",
        date: new Date().toLocaleDateString()
    };

    const loadDocuments = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/documents/list`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
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

    useEffect(() => {
        loadDocuments();
    }, []);

    const handleAcceptContract = () => {
        setAcceptLoading(true);
        // Simulate API call
        setTimeout(() => {
            setAcceptLoading(false);
            setShowAcceptSuccess(true);
        }, 1500);
    };

    const handleUploadClick = (type) => {
        setUploadType(type);
        setShowUploadModal(true);
    };

    const handleUploadComplete = () => {
        setShowUploadModal(false);
        loadDocuments();
    };

    // Reuse existing handleApprove/Share if needed, or pass empty functions if not applicable for client
    const handleApprove = async () => { };
    const handleShare = () => { };

    return (
        <div className="dashboard">
            <Navbar user={user} onLogout={onLogout} title="Client Portal" />

            <div className="grid">
                {/* Assigned Contract Card */}
                <div className="card" style={{ gridColumn: '1 / -1' }}>
                    <h3>
                        <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Assigned Contract
                    </h3>

                    <div className="assigned-contract-content" style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginTop: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                            <div>
                                <h4 style={{ margin: 0, color: 'var(--text)' }}>{assignedContract.title}</h4>
                                <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                    Assigned by {assignedContract.assignedBy} on {assignedContract.date}
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <a
                                    href={assignedContract.driveLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary"
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
                                >
                                    <svg style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    View Drive Link
                                </a>

                                <button
                                    className="btn btn-success"
                                    onClick={handleAcceptContract}
                                    disabled={acceptLoading}
                                >
                                    {acceptLoading ? 'Accepting...' : 'Accept Contract'}
                                </button>
                            </div>
                        </div>

                        <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
                            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                Need to make changes? Upload a redlined version or your own contract draft.
                            </p>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button className="btn btn-primary" onClick={() => handleUploadClick('Redlined')}>
                                    Upload Redlined Contract
                                </button>
                                <button className="btn btn-secondary" onClick={() => handleUploadClick('Others')}>
                                    Upload Own Contract
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Documents History Log */}
                <div className="card" style={{ gridColumn: '1 / -1' }}>
                    <h3>
                        <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Document History
                    </h3>
                    <DocumentsTable
                        documents={documents}
                        loading={loading}
                        onApprove={handleApprove}
                        onShare={handleShare}
                        currentUser={user}
                    />
                </div>
            </div>

            {/* Upload Modal */}
            <Modal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)}>
                <h3>Upload {uploadType === 'Redlined' ? 'Redlined Contract' : 'Document'}</h3>
                <div style={{ marginTop: '1rem' }}>
                    <UploadArea onUploadComplete={handleUploadComplete} documentType={uploadType} />
                </div>
            </Modal>

            {/* Success Modal */}
            <Modal isOpen={showAcceptSuccess} onClose={() => setShowAcceptSuccess(false)}>
                <h3>Contract Accepted!</h3>
                <div className="alert alert-success">
                    <span>✓</span>
                    <span>The Legal Team has been notified of your acceptance.</span>
                </div>
            </Modal>
        </div>
    );
}

export default ClientDashboard;
