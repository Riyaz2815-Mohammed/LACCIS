import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './DocumentsTable.css';
import { apiFetch } from '../utils/api';

function DocumentsTable({ documents, loading, onApprove, onReject, onDownload, onFinalize, currentUser, hideActions = false }) {
    const navigate = useNavigate();

    const formatFileSize = (bytes) => {
        if (!bytes || isNaN(bytes)) return 'Unknown Size';
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const getStatusBadge = (status, isFinal) => {
        if (isFinal) return { class: 'badge-success', text: '✔ Final' };
        const badges = {
            'pending': { class: 'badge-pending', text: 'Pending Approval' },
            'approved': { class: 'badge-success', text: 'Approved' },
            'rejected': { class: 'badge-danger', text: 'Rejected' },
            'uploaded': { class: 'badge-success', text: 'Uploaded' }
        };
        return badges[status] || badges['uploaded'];
    };

    const getDocumentTypeColor = (type) => {
        const colors = {
            'NDA': '#ef4444',
            'MSA': '#3b82f6',
            'SOW': '#10b981',
            'Redlined': '#f59e0b',
            'Others': '#6366f1'
        };
        return colors[type] || '#6366f1';
    };

    const handleDownload = async (docId) => {
        if (onDownload) {
            onDownload(docId);
            return;
        }
        try {
            const res = await apiFetch('/api/documents/download/${docId}');
            const data = await res.json();
            if (data.download_url) {
                window.open(data.download_url, '_blank');
            } else {
                alert('Download failed: no URL returned');
            }
        } catch (err) {
            console.error('Download error:', err);
            alert('Download failed');
        }
    };

    const [loadingDocs, setLoadingDocs] = useState({});

    const handleReviewClick = async (doc) => {
        if (doc.document_type?.includes('Redlined')) {
            setLoadingDocs(prev => ({ ...prev, [doc.id]: true }));
            try {
                const res = await apiFetch('/api/documents/google-doc/${doc.id}', {
                    method: 'POST',
                });
                if (!res.ok) throw new Error('Failed to open Google Docs');
                const data = await res.json();
                window.open(data.url, '_blank');
            } catch (err) {
                console.error('API Error:', err);
                alert('Could not open document in Google Docs.');
            } finally {
                setLoadingDocs(prev => ({ ...prev, [doc.id]: false }));
            }
        } else {
            navigate(
                isAdmin
                    ? `/review/${doc.id}`
                    : `/analysis/${doc.id}`
            );
        }
    };

    const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'legal_team';

    const tableHead = (
        <thead>
            <tr>
                <th>Document Name</th>
                <th>Type</th>
                <th>Upload Date</th>
                <th>Status</th>
                <th>Size</th>
                {!hideActions && <th>Actions</th>}
                {isAdmin && <th>Finalize</th>}
            </tr>
        </thead>
    );

    if (loading) {
        return (
            <table className="table">
                {tableHead}
                <tbody>
                    <tr>
                        <td colSpan={hideActions ? "5" : "6"} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            Loading documents...
                        </td>
                    </tr>
                </tbody>
            </table>
        );
    }

    if (documents.length === 0) {
        return (
            <table className="table">
                {tableHead}
                <tbody>
                    <tr>
                        <td colSpan={hideActions ? "5" : "6"} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            No documents uploaded yet. Upload your first document above!
                        </td>
                    </tr>
                </tbody>
            </table>
        );
    }

    return (
        <table className="table">
            {tableHead}
            <tbody>
                {documents.map((doc) => {
                    const isFinal = (doc.document_type && doc.document_type.includes('Final')) || doc.is_finalized || doc.is_final || false;
                    const statusBadge = getStatusBadge(doc.status, isFinal);
                    return (
                        <tr key={doc.id}>
                            <td>{doc.filename}</td>
                            <td>
                                <span style={{
                                    color: getDocumentTypeColor(doc.document_type),
                                    fontWeight: 600,
                                    fontSize: '0.875rem'
                                }}>
                                    {doc.document_type || 'Others'}
                                    {(!doc.document_type || !doc.document_type.includes('Final')) &&
                                        (doc.is_finalized ? ' (Final)' : (doc.client_marked_final ? ' (Client Final)' : ''))
                                    }
                                </span>
                            </td>
                            <td>{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                            <td>
                                <span className={`badge ${statusBadge.class}`}>
                                    {statusBadge.text}
                                </span>
                            </td>
                            <td>{formatFileSize(doc.size)}</td>
                            {!hideActions && (
                                <td>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        {/* Accept / Reject — hidden if final */}
                                        {isAdmin && !isFinal && (doc.status === 'pending' || doc.status === 'uploaded') && (
                                            <>
                                                <button
                                                    className="btn-action btn-approve-full"
                                                    onClick={() => onApprove && onApprove(doc.id)}
                                                    title="Accept Document"
                                                >
                                                    ✔️
                                                </button>
                                                <button
                                                    className="btn-action btn-reject"
                                                    onClick={() => onReject && onReject(doc.id)}
                                                    title="Reject Document"
                                                >
                                                    ❌
                                                </button>
                                            </>
                                        )}
                                        <button
                                            className="btn-action btn-download"
                                            onClick={() => handleDownload(doc.id)}
                                            title="Download Document"
                                        >
                                            ⬇
                                        </button>
                                        {/* Review button — hidden when document is final */}
                                        {!isFinal && (
                                            <button
                                                className="btn-action btn-review"
                                                onClick={() => handleReviewClick(doc)}
                                                title={isAdmin ? "Review Clauses (SBERT + AI)" : "View AI Analysis"}
                                                disabled={loadingDocs[doc.id]}
                                            >
                                                {loadingDocs[doc.id]
                                                    ? <span className="spinner-small" style={{ margin: '0 8px' }} />
                                                    : (isAdmin ? ' Review' : 'View')
                                                }
                                            </button>
                                        )}
                                    </div>
                                </td>
                            )}
                            {isAdmin && (
                                <td style={{ textAlign: 'center' }}>
                                    {(!doc.document_type || !doc.document_type.includes('Redline')) && (
                                        <input
                                            type="checkbox"
                                            checked={doc.is_finalized || false}
                                            onChange={() => onFinalize && onFinalize(doc.id)}
                                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                            title="Mark as Finalized"
                                        />
                                    )}
                                </td>
                            )}
                        </tr>
                    );
                })}
            </tbody >
        </table >
    );
}

export default DocumentsTable;