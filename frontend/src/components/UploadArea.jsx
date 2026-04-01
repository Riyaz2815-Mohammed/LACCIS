import { useState } from 'react';
import './UploadArea.css';
import { apiFetch } from '../utils/api';

function UploadArea({ onUploadComplete, documentType: externalDocumentType }) {
    const [files, setFiles] = useState([]);
    const [dragOver, setDragOver] = useState(false);
    const [documentType, setDocumentType] = useState('');
    const [step, setStep] = useState(1);
    const [error, setError] = useState('');
    const [isFinalized, setIsFinalized] = useState(false);

    // Set the document type as "Type (Redlined)" if they clicked Upload Redlined
    const handleStep1Complete = () => {
        if (!documentType) {
            setError('Please select a document type first');
            return;
        }
        setError('');
        setStep(2);
    };

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
            documentType: externalDocumentType === 'Redlined' ? `${documentType} (Redlined)` : documentType
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

            // If NDA is chosen, backend will trigger extraction automatically
            const fd = new FormData();
            fd.append('file', fileObj.file);
            fd.append('is_final', isFinalized);
            const response = await apiFetch(
                `/api/documents/upload?document_type=${fileObj.documentType}`,
                {
                    method: 'POST',
                    headers: {},  // let browser set multipart boundary
                    body: fd,
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
                setIsFinalized(false);
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
            'RA': '#8b5cf6',
            'MSA': '#3b82f6',
            'SOW': '#10b981',
            'NA': '#64748b',
            'Redlined': '#f59e0b',
            'Others': '#6366f1'
        };
        return colors[type] || '#6366f1';
    };

    return (
        <div className="upload-workflow">
            {step === 1 && (
                <div className="workflow-step step-1">
                    <div className="document-type-selector">
                        <label htmlFor="documentType" style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>
                            Step 1: Select Document Type
                        </label>
                        <select
                            id="documentType"
                            value={documentType}
                            onChange={(e) => setDocumentType(e.target.value)}
                            className="form-control"
                            style={{ padding: '1rem', fontSize: '1rem', fontWeight: '600', border: '2px solid #e2e8f0' }}
                        >
                            <option value="">-- Choose Type --</option>
                            <option value="NDA">NDA (Non-Disclosure Agreement)</option>
                            <option value="MSA">MSA (Master Service Agreement)</option>
                            <option value="SOW">SOW (Statement of Work)</option>
                            <option value="RA">Referral Agreement</option>

                        </select>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '1rem' }}>
                            {documentType === 'NDA' && ' Automated extraction and classification will be performed for NDAs.'}
                            {documentType === 'RA' && 'Referral Agreement - Document storage.'}
                            {documentType === 'MSA' && 'Master Service Agreement - Major legal contract.'}
                            {documentType === 'SOW' && 'Statement of Work - Project details and deliverables.'}

                        </p>
                        <button
                            className="btn btn-primary"
                            style={{ marginTop: '1.5rem', width: '100%', padding: '1rem' }}
                            onClick={handleStep1Complete}
                            disabled={!documentType}
                        >
                            Next: Select File
                        </button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="workflow-step step-2">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h4 style={{ margin: 0 }}>
                            Step 2: Upload
                            <span style={{ color: getDocumentTypeColor(documentType), marginLeft: '0.5rem' }}>
                                {externalDocumentType === 'Redlined' ? `${documentType} (Redlined)` : documentType}
                            </span>
                        </h4>
                        <button className="btn-text" onClick={() => setStep(1)} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                            Change Type
                        </button>
                    </div>

                    <div
                        className={`upload-area ${dragOver ? 'dragover' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        <div className="upload-icon"></div>
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
                    </div>

                    {/* Hide "Mark as Final" for Redlined uploads — only allow it for own contracts */}
                    {externalDocumentType !== 'Redlined' && (
                        <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                            <input
                                type="checkbox"
                                id="isFinalCheckbox"
                                checked={isFinalized}
                                onChange={(e) => setIsFinalized(e.target.checked)}
                                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                            />
                            <label htmlFor="isFinalCheckbox" style={{ fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                                Mark as Final Document
                            </label>
                        </div>
                    )}
                </div>
            )
            }

            {
                error && (
                    <div className="alert alert-error" style={{ marginTop: '1rem' }}>
                        <span></span>
                        <span>{error}</span>
                    </div>
                )
            }

            {
                files.length > 0 && (
                    <div className="file-list">
                        {files.map((fileObj, index) => (
                            <div key={index} className="file-item">
                                <div className="file-info">
                                    <span></span>
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
                )
            }
        </div >
    );
}

export default UploadArea;