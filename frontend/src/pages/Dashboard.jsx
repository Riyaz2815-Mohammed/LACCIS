import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import ClientForm from '../components/ClientForm';
import ClientsTable from '../components/ClientsTable';
import StatsCard from '../components/StatsCard';
import ClientDashboard from './ClientDashboard';
import './Dashboard.css';

const API_URL = 'http://localhost:8000';

function Dashboard({ user, onLogout }) {
    if (user.role === 'client') {
        return <ClientDashboard user={user} onLogout={onLogout} />;
    }

    const [clients, setClients] = useState([]);
    const [stats, setStats] = useState({ totalDocs: 0, totalClients: 0 });
    const [loading, setLoading] = useState(true);

    const loadClients = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/clients/list`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok) {
                setClients(data.clients);
                setStats(prev => ({ ...prev, totalClients: data.clients.length }));
            }
        } catch (error) {
            console.error('Error loading clients:', error);
        }
    };

    const loadStats = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/documents/stats`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok) {
                setStats(prev => ({ ...prev, totalDocs: data.total_documents || 0 }));
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadClients();
        loadStats();
    }, []);

    const handleClientCreated = () => {
        loadClients();
    };

    const handleClientDelete = async (client) => {
        if (!window.confirm(`Are you sure you want to delete ${client.name}? This will remove their account and all associated documents.`)) {
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/clients/delete/${client.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                loadClients();
                loadStats();
            } else {
                const data = await response.json();
                alert(data.detail || 'Failed to delete client');
            }
        } catch (error) {
            console.error('Error deleting client:', error);
            alert('Failed to delete client');
        }
    };

    return (
        <div className="dashboard">
            <Navbar user={user} onLogout={onLogout} />

            <div className="grid">
                <ClientForm onClientCreated={handleClientCreated} />

                <div className="card clients-card">
                    <h3>
                        <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        Recent Clients
                    </h3>
                    <ClientsTable clients={clients} loading={loading} onDelete={handleClientDelete} />
                </div>

                <div className="stats-column">
                    <StatsCard
                        title="Total Documents"
                        value={stats.totalDocs}
                        icon={
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        }
                    />

                    <StatsCard
                        title="Active Clients"
                        value={stats.totalClients}
                        icon={
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 4 0 014 0z" />
                        }
                    />
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
