import { useState } from 'react';
import './UploadArea.css';

const API_URL = 'http://localhost:8000';

function UploadArea({ onUploadComplete, documentType: externalDocumentType }) {
    const [files, setFiles] = useState([]);
    const [dragOver, setDragOver] = useState(false);
    const [documentType, setDocumentType] = useState(externalDocumentType || 'NDA');
    const [error, setError] = useState('');

    const handleDragOver = (e) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleDragLeave = () => {
        setDragOver(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        handleFiles(droppedFiles);
    };

    const handleFileInput = (e) => {
        const selectedFiles = Array.from(e.target.files);
        handleFiles(selectedFiles);
    };

    const handleFiles = (fileList) => {
        setError('');
        const newFiles = fileList.map(file => ({
            file,
            name: file.name,
            size: file.size,
            progress: 0,
            status: 'uploading',
            documentType: documentType
        }));

        setFiles(prev => [...prev, ...newFiles]);

        newFiles.forEach((fileObj, index) => {
            uploadFile(fileObj, files.length + index);
        });
    };

    const uploadFile = async (fileObj, index) => {
        const formData = new FormData();
        formData.append('file', fileObj.file);

        try {
            const token = localStorage.getItem('token');

            // Simulate progress
            const progressInterval = setInterval(() => {
                setFiles(prev => {
                    const updated = [...prev];
                    if (updated[index] && updated[index].progress < 90) {
                        updated[index].progress += 10;
                    }
                    return updated;
                });
            }, 100);

            const response = await fetch(
                `${API_URL}/api/documents/upload?document_type=${fileObj.documentType}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                }
            );

            clearInterval(progressInterval);

            if (response.ok) {
                setFiles(prev => {
                    const updated = [...prev];
                    if (updated[index]) {
                        updated[index].progress = 100;
                        updated[index].status = 'success';
                    }
                    return updated;
                });
                onUploadComplete();
            } else {
                const data = await response.json();
                setError(data.detail || 'Upload failed');
                setFiles(prev => {
                    const updated = [...prev];
                    if (updated[index]) {
                        updated[index].status = 'error';
                        updated[index].error = data.detail;
                    }
                    return updated;
                });
            }
        } catch (error) {
            setFiles(prev => {
                const updated = [...prev];
                if (updated[index]) {
                    updated[index].status = 'error';
                }
                return updated;
            });
        }
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
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
            'Others': '#6366f1'
        };
        return colors[type] || '#6366f1';
    };

    return (
        <>
            {!externalDocumentType && (
                <div className="document-type-selector">
                    <label htmlFor="documentType">Document Type:</label>
                    <select
                        id="documentType"
                        value={documentType}
                        onChange={(e) => setDocumentType(e.target.value)}
                        className="form-control"
                        style={{ marginTop: '0.5rem' }}
                    >
                        <option value="NDA">NDA (Non-Disclosure Agreement)</option>
                        <option value="MSA">MSA (Master Service Agreement)</option>
                        <option value="SOW">SOW (Statement of Work)</option>
                        <option value="Redlined">Redlined Document</option>
                        <option value="Others">Others</option>
                    </select>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                        {documentType === 'NDA' && '⚠️ NDA must be uploaded and approved first'}
                        {documentType === 'MSA' && 'Master Service Agreement - Requires approved NDA'}
                        {documentType === 'SOW' && 'Statement of Work - Requires approved NDA'}
                        {documentType === 'Redlined' && 'Document with tracked changes'}
                        {documentType === 'Others' && 'Other legal documents'}
                    </p>
                </div>
            )}

            {error && (
                <div className="alert alert-error" style={{ marginTop: '1rem' }}>
                    <span>⚠</span>
                    <span>{error}</span>
                </div>
            )}

            <div
                className={`upload-area ${dragOver ? 'dragover' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ marginTop: '1.5rem' }}
            >
                <div className="upload-icon">📄</div>
                <h3>Drag & Drop Files Here</h3>
                <p style={{ color: 'var(--text-muted)', margin: '1rem 0' }}>or</p>
                <input
                    type="file"
                    id="fileInput"
                    multiple
                    accept=".pdf,.doc,.docx,.txt"
                    style={{ display: 'none' }}
                    onChange={handleFileInput}
                />
                <button
                    className="btn btn-primary"
                    onClick={() => document.getElementById('fileInput').click()}
                >
                    Browse Files
                </button>
                <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>
                    Supported formats: PDF, DOC, DOCX, TXT
                </p>
            </div>

            {files.length > 0 && (
                <div className="file-list">
                    {files.map((fileObj, index) => (
                        <div key={index} className="file-item">
                            <div className="file-info">
                                <span>📄</span>
                                <div>
                                    <div style={{ fontWeight: 600 }}>{fileObj.name}</div>
                                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                                        {formatFileSize(fileObj.size)} •
                                        <span style={{
                                            color: getDocumentTypeColor(fileObj.documentType),
                                            marginLeft: '0.5rem',
                                            fontWeight: 600
                                        }}>
                                            {fileObj.documentType}
                                        </span>
                                    </div>
                                    {fileObj.error && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>
                                            {fileObj.error}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div style={{ flex: 1, margin: '0 1rem' }}>
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{ width: `${fileObj.progress}%` }}
                                    ></div>
                                </div>
                            </div>
                            <span className={`badge badge-${fileObj.status === 'success' ? 'success' : fileObj.status === 'error' ? 'danger' : 'pending'}`}>
                                {fileObj.status === 'success' ? 'Uploaded' : fileObj.status === 'error' ? 'Failed' : 'Uploading...'}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}

export default UploadArea;
