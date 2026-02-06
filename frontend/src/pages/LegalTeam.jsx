import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import LegalTeamForm from '../components/LegalTeamForm';
import LegalTeamTable from '../components/LegalTeamTable';
import '../pages/Dashboard.css'; // Reuse dashboard styles

const API_URL = 'http://localhost:8000';

function LegalTeam({ user, onLogout }) {
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadMembers = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/legal/list`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok) {
                setMembers(data.members || []);
            }
        } catch (error) {
            console.error('Error loading legal team members:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMembers();
    }, []);

    const handleMemberCreated = () => {
        loadMembers();
    };

    const handleMemberDelete = async (member) => {
        if (!window.confirm(`Are you sure you want to delete ${member.name}? This will remove their account.`)) {
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/legal/delete/${member.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                loadMembers();
            } else {
                const data = await response.json();
                alert(data.detail || 'Failed to delete member');
            }
        } catch (error) {
            console.error('Error deleting member:', error);
            alert('Failed to delete member');
        }
    };

    return (
        <div className="dashboard">
            <Navbar user={user} onLogout={onLogout} title="Legal Team Management" />

            <div className="grid">
                <LegalTeamForm onMemberCreated={handleMemberCreated} />

                <div className="card clients-card">
                    <h3>
                        <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 4 0 014 0z" />
                        </svg>
                        Legal Team Members
                    </h3>
                    <LegalTeamTable members={members} loading={loading} onDelete={handleMemberDelete} />
                </div>
            </div>
        </div>
    );
}

export default LegalTeam;
