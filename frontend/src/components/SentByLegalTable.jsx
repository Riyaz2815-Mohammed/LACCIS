import './SentByLegalTable.css';

const API_URL = 'http://localhost:8000';

function SentByLegalTable({ documents, loading, onFinalize }) {
    const formatFileSize = (bytes) => {
        if (!bytes || isNaN(bytes) || bytes === 0) return '—';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const getDocumentTypeColor = (type) => {
        const colors = {
            'NDA': '#ef4444',
            'MSA': '#3b82f6',
            'SOW': '#10b981',
            'Redlined': '#f59e0b',
            'RA': '#8b5cf6',
            'Vendor Agreement': '#06b6d4',
            'Others': '#6366f1',
        };
        return colors[type] || '#6366f1';
    };

    const handleDownload = async (docId) => {
        try {
            const token = localStorage.getItem('token');
            // Try documents endpoint first, then contracts endpoint
            const res = await fetch(`${API_URL}/api/documents/download/${docId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
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

    const tableHead = (
        <thead>
            <tr>
                <th>Document Name</th>
                <th>Type</th>
                <th>Sent Date</th>
                <th>Status</th>
                <th>Size</th>
                <th>Download</th>
                <th>Finalize</th>
            </tr>
        </thead>
    );

    if (loading) {
        return (
            <table className="table">
                {tableHead}
                <tbody>
                    <tr>
                        <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            Loading sent documents...
                        </td>
                    </tr>
                </tbody>
            </table>
        );
    }

    if (!documents || documents.length === 0) {
        return (
            <table className="table">
                {tableHead}
                <tbody>
                    <tr>
                        <td colSpan="7" className="sbl-empty-cell">
                            <div className="sbl-empty">
                                <span className="sbl-empty-icon">📤</span>
                                <p>No documents sent to this client yet.</p>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        );
    }

    const sortedDocuments = [...documents].sort((a, b) => {
        const dateA = new Date(a.shared_at || a.uploaded_at || 0);
        const dateB = new Date(b.shared_at || b.uploaded_at || 0);
        return dateB - dateA; // Descending
    });

    return (
        <table className="table">
            {tableHead}
            <tbody>
                {sortedDocuments.map((doc) => {
                    const isFinal = doc.is_finalized || doc.is_final || false;
                    return (
                        <tr key={doc.id}>
                            <td className="sbl-filename">{doc.filename}</td>
                            <td>
                                <span style={{
                                    color: getDocumentTypeColor(doc.document_type),
                                    fontWeight: 600,
                                    fontSize: '0.875rem',
                                }}>
                                    {doc.document_type || 'Others'}
                                    {(!doc.document_type || !doc.document_type.includes('Final')) && isFinal ? ' (Final)' : ''}
                                </span>
                            </td>
                            <td>
                                {doc.shared_at
                                    ? new Date(doc.shared_at).toLocaleDateString()
                                    : doc.uploaded_at
                                        ? new Date(doc.uploaded_at).toLocaleDateString()
                                        : '—'}
                            </td>
                            <td>
                                {isFinal ? (
                                    <span className="badge badge-final">✔ Final</span>
                                ) : (
                                    <span className="badge badge-pending">Sent</span>
                                )}
                            </td>
                            <td>{formatFileSize(doc.size)}</td>
                            {/* Download only — no Review / Accept / Reject */}
                            <td style={{ textAlign: 'center' }}>
                                <button
                                    className="btn-action btn-download"
                                    onClick={() => handleDownload(doc.id)}
                                    title="Download Document"
                                >
                                    ⬇
                                </button>
                            </td>
                            {/* Finalize checkbox */}
                            <td style={{ textAlign: 'center' }}>
                                {(!doc.document_type || !doc.document_type.includes('Redline')) && (
                                    <input
                                        type="checkbox"
                                        checked={isFinal}
                                        onChange={() => onFinalize && onFinalize(doc.id)}
                                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                        title="Mark as Finalized"
                                    />
                                )}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export default SentByLegalTable;
