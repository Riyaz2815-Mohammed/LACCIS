import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import axios from 'axios';
import Layout from '../layouts/Layout';
import './RedlineReview.css';

const API_URL = 'http://localhost:8000';

const RedlineReview = ({ user, onLogout }) => {
    const { documentId } = useParams();
    const navigate = useNavigate();
    const [htmlContent, setHtmlContent] = useState('');
    const [filename, setFilename] = useState('');
    const [standardClauses, setStandardClauses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [reviewMode, setReviewMode] = useState('redline'); // 'redline' or 'finalize'
    const quillRef = useRef(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const token = localStorage.getItem('token');
                const [contentRes, clausesRes] = await Promise.all([
                    axios.get(`${API_URL}/api/documents/redline-content/${documentId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                    axios.get(`${API_URL}/api/legal/standard-clauses`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                ]);

                setHtmlContent(contentRes.data.html_content);
                setFilename(contentRes.data.filename);
                setStandardClauses(clausesRes.data.clauses);
            } catch (err) {
                console.error('Error fetching data:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [documentId]);

    // Track text changes for redline mode
    useEffect(() => {
        if (!quillRef.current || reviewMode !== 'redline') return;
        const quill = quillRef.current.getEditor();

        const handleTextChange = (delta, oldDelta, source) => {
            if (source === 'user') {
                // Apply red color and underline to new insertions
                delta.ops.forEach(op => {
                    if (op.insert && typeof op.insert === 'string' && op.insert !== '\n') {
                        const range = quill.getSelection();
                        if (range) {
                            quill.formatText(range.index - op.insert.length, op.insert.length, {
                                'color': '#ff0000',
                                'underline': true
                            });
                        }
                    }
                });
            }
        };

        quill.on('text-change', handleTextChange);
        return () => quill.off('text-change', handleTextChange);
    }, [reviewMode]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_URL}/api/documents/redline-save/${documentId}`,
                { html_content: htmlContent },
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            alert('Document saved successfully!');
        } catch (err) {
            console.error('Save error:', err);
            alert('Failed to save document');
        } finally {
            setSaving(false);
        }
    };

    const handleDownload = async () => {
        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(`${API_URL}/api/documents/redline-save/${documentId}`,
                { html_content: htmlContent },
                { headers: { 'Authorization': `Bearer ${token}` } }
            );

            const downloadRes = await fetch(`${API_URL}/api/documents/download-file?s3_key=${res.data.s3_key}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const blob = await downloadRes.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Edited_${filename.replace('.pdf', '.docx')}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download error:', err);
            alert('Failed to download document');
        } finally {
            setSaving(false);
        }
    };

    const handleSend = async () => {
        if (!window.confirm('Are you sure you want to send this updated document to the customer?')) return;
        setSending(true);
        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_URL}/api/documents/redline-send/${documentId}`,
                { html_content: htmlContent },
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            alert('Document sent to customer successfully!');
            navigate(-1);
        } catch (err) {
            console.error('Send error:', err);
            alert('Failed to send document');
        } finally {
            setSending(false);
        }
    };

    const filteredClauses = standardClauses.filter(c =>
        (c.type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.content || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert('Clause copied to clipboard!');
    };

    if (loading) {
        return (
            <Layout user={user} onLogout={onLogout} pageTitle="Redline Review">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Preparing document for editing...</p>
                </div>
            </Layout>
        );
    }

    return (
        <Layout user={user} onLogout={onLogout} pageTitle={`Review: ${filename}`}>
            <div className={`redline-review-container view-mode-${reviewMode}`}>
                <div className="review-header">
                    <button className="btn-back" onClick={() => navigate(-1)}>← Back</button>
                    <h2 className="header-title">Redline Review - {filename}</h2>
                    <div className="header-actions">
                        <button className="btn-secondary btn-save-draft" onClick={handleSave} disabled={saving || sending}>
                            {saving ? 'Saving...' : '💾 Save Draft'}
                        </button>
                    </div>
                </div>

                <div className="review-main">
                    <div className="editor-panel">
                        <div className="panel-header-alt">
                            <div className="mode-toggle-group">
                                <button
                                    className={`toggle-btn ${reviewMode === 'redline' ? 'active' : ''}`}
                                    onClick={() => setReviewMode('redline')}
                                >
                                    Redlining mode
                                </button>
                                <button
                                    className={`toggle-btn ${reviewMode === 'finalize' ? 'active' : ''}`}
                                    onClick={() => setReviewMode('finalize')}
                                >
                                    Finalizing mode
                                </button>
                            </div>
                        </div>
                        <div className="quill-wrapper scroll-container">
                            <ReactQuill
                                ref={quillRef}
                                theme="snow"
                                value={htmlContent}
                                onChange={setHtmlContent}
                                modules={{
                                    toolbar: [
                                        [{ 'header': [1, 2, 3, false] }],
                                        ['bold', 'italic', 'underline', 'strike'],
                                        [{ 'color': [] }, { 'background': [] }],
                                        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                                        ['clean']
                                    ]
                                }}
                            />
                        </div>
                    </div>

                    <div className="clauses-panel">
                        <div className="panel-header">
                            <h3 className="panel-title">Standard Clause Library</h3>
                            <input
                                type="text"
                                placeholder="Search clauses..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="clause-search-input"
                            />
                        </div>
                        <div className="clauses-list-bubbles scroll-container">
                            {filteredClauses.map((clause, idx) => (
                                <div key={clause.id || idx} className="clause-bubble-card" onClick={() => copyToClipboard(clause.content)}>
                                    <div className="bubble-header">
                                        {idx + 1}. {clause.type}
                                    </div>
                                    <div className="bubble-body">{clause.content}</div>
                                </div>
                            ))}
                            {filteredClauses.length === 0 && <p className="no-results">No clauses found.</p>}
                        </div>
                    </div>
                </div>

                <div className="review-footer">
                    <div className="footer-left">
                        <span className="footer-note">Formatting is preserved during DOCX export.</span>
                    </div>
                    <div className="footer-right">
                        <button className="btn-download-edited" onClick={handleDownload} disabled={saving || sending}>
                            📄 Download Updated Document
                        </button>
                        <button className="btn-send-customer" onClick={handleSend} disabled={saving || sending}>
                            {sending ? 'Sending...' : '🚀 Send to Customer'}
                        </button>
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default RedlineReview;
