import { useState } from 'react';
import Modal from './Modal';
import './LegalTeamForm.css';

const API_URL = 'http://localhost:8000';

function LegalTeamForm({ onMemberCreated }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    const [showModal, setShowModal] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setAlert(null);

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/legal/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, email })
            });

            const data = await response.json();

            if (response.ok) {
                setName('');
                setEmail('');
                setShowModal(true);
                onMemberCreated();
            } else {
                setAlert({ type: 'error', message: data.detail || 'Failed to send credentials' });
            }
        } catch (error) {
            setAlert({ type: 'error', message: 'Connection error. Please ensure the backend is running.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="card">
                <h3>
                    <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Add Legal Team Member
                </h3>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="memberName">Name</label>
                        <input
                            type="text"
                            id="memberName"
                            className="form-control"
                            placeholder="Jane Doe"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="memberEmail">Email</label>
                        <input
                            type="email"
                            id="memberEmail"
                            className="form-control"
                            placeholder="lawyer@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    {alert && (
                        <div className={`alert alert-${alert.type}`}>
                            <span>{alert.type === 'success' ? '✓' : '⚠'}</span>
                            <span>{alert.message}</span>
                        </div>
                    )}

                    <button type="submit" className="btn btn-success" disabled={loading}>
                        {loading ? (
                            <>
                                <span className="spinner"></span>
                                <span>Sending...</span>
                            </>
                        ) : (
                            <span>Create & Send Credentials</span>
                        )}
                    </button>
                </form>
            </div>

            <Modal isOpen={showModal} onClose={() => setShowModal(false)}>
                <h3>Credentials Sent Successfully!</h3>
                <div className="alert alert-success">
                    <span>✓</span>
                    <span>Login credentials have been sent to the legal team member's email address.</span>
                </div>
                <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
                    They can now log in using the credentials sent to their email.
                </p>
            </Modal>
        </>
    );
}

export default LegalTeamForm;
