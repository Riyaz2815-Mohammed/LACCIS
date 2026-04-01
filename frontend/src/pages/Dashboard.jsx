import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../layouts/Layout';
import ClientsTable from '../components/ClientsTable';
import StatsCard from '../components/StatsCard';
import ClientDashboard from './ClientDashboard';
import { apiFetch } from '../utils/api';
import './Dashboard.css';

function Dashboard({ user, onLogout }) {
    const navigate = useNavigate();

    // Only actual clients see the client dashboard — admins and legal team see the full dashboard
    if (user?.role === 'client') {
        return <ClientDashboard user={user} onLogout={onLogout} />;
    }

    if (!user) return null;

    const [clients, setClients] = useState([]);
    const [stats, setStats] = useState({ totalDocs: 0, totalClients: 0, pendingReviews: 0 });
    const [recentDocs, setRecentDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    const loadClientsAndStats = async () => {
        try {
        const [clientsRes, docsRes] = await Promise.all([
                apiFetch('/api/clients/list'),
                apiFetch('/api/documents/list'),
            ]);

            const clientsData = await clientsRes.json();
            const docsData = await docsRes.json();
            const sharedData = sharedRes.ok ? await sharedRes.json() : { contracts: [] };

            if (clientsRes.ok && docsRes.ok) {
                // Merge regular documents and shared contracts smoothly
                const baseDocs = docsData.documents || [];
                const sharedContracts = sharedData.contracts || [];
                // Map shared_contracts to match standard documents shape for counting
                const mappedContracts = sharedContracts.map(c => ({
                    ...c,
                    shared_with: [c.client_id], // Used below to attach to specific client mapping
                    user_role: 'legal_team'
                }));

                const documents = [...baseDocs, ...mappedContracts];

                // Sort by last modified/created (using uploaded_at or date proxy)
                const sorted = [...documents].sort((a, b) => (b.uploaded_at > a.uploaded_at ? 1 : -1)).slice(0, 5);
                setRecentDocs(sorted);

                let sumTotalDocs = 0;
                let sumPendingReviews = 0;

                const clientList = clientsData.clients.map(client => {
                    const clientDocs = documents.filter(d =>
                        d.user_id === client.id || (Array.isArray(d.shared_with) && d.shared_with.includes(client.id))
                    );
                    const pendingCount = clientDocs.filter(d => d.status === 'pending' || d.status === 'uploaded').length;
                    const finalizedDocs = clientDocs.filter(d => d.is_finalized);

                    sumTotalDocs += clientDocs.length;
                    sumPendingReviews += pendingCount;

                    return {
                        ...client,
                        totalDocs: clientDocs.length,
                        pendingDocs: pendingCount,
                        finalizedDocs: finalizedDocs.map(d => ({
                            id: d.id,
                            filename: d.filename,
                            type: d.document_type
                        }))
                    };
                });

                setClients(clientList);
                setStats({
                    totalDocs: sumTotalDocs,
                    totalClients: clientList.length,
                    pendingReviews: sumPendingReviews
                });
            }
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadClientsAndStats();
    }, []);

    const handleClientCreated = () => {
        loadClientsAndStats();
    };

    const handleClientDelete = async (client) => {
        if (!window.confirm(`Are you sure you want to delete ${client.name}?`)) return;

        try {
        const response = await apiFetch(`/api/clients/delete/${client.id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                loadClientsAndStats();
            } else {
                const data = await response.json();
                alert(data.detail || 'Failed to delete client');
            }
        } catch (error) {
            console.error('Error deleting client:', error);
        }
    };

    const handleOpenWorkspace = (client) => {
        navigate(`/workspace/${client.id}`);
    };

    const filteredClients = clients.filter(client =>
        client.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <Layout user={user} onLogout={onLogout} pageTitle="Dashboard">
            <div className="dashboard-content-v2">
                <div className="stats-row">
                    <StatsCard
                        title="Total Documents"
                        value={stats.totalDocs}
                        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />}
                    />
                    <StatsCard
                        title="Active Clients"
                        value={stats.totalClients}
                        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 4 0 014 0z" />}
                    />
                    <StatsCard
                        title="Pending Reviews"
                        value={stats.pendingReviews}
                        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
                    />
                </div>

                <div className="quick-actions-section" style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div className="section-header" style={{ margin: 0 }}>
                        <h2 style={{ fontSize: '1.25rem' }}>Quick Actions:</h2>
                    </div>
                    <button className="dashboard-btn primary" onClick={() => navigate('/invite-client')} style={{ width: 'auto', padding: '0.6rem 1.2rem' }}>
                        <span></span> Invite New Client
                    </button>
                    <button className="dashboard-btn secondary" onClick={() => navigate('/templates')} style={{ width: 'auto', padding: '0.6rem 1.2rem' }}>
                        <span></span> Manage Templates
                    </button>
                </div>

                <div className="section-header" style={{ marginTop: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2>All Clients</h2>
                        <p>Manage and monitor legal workspaces</p>
                    </div>
                    <div className="search-pill">
                        <input
                            type="text"
                            placeholder="Search clients..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div style={{ marginTop: '1rem' }}>
                    <ClientsTable
                        clients={filteredClients}
                        loading={loading}
                        onDelete={handleClientDelete}
                        onOpenWorkspace={handleOpenWorkspace}
                    />
                </div>
            </div>
        </Layout>
    );
}

export default Dashboard;