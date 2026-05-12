{/* The Order Tracking Block */}
{view === 'tracking' && activeOrder && (
  <div className="tracking-container">
    {/* Real-time Status Header */}
    <div className="tracking-header">
      <h2>Status: {activeOrder.status}</h2>
      <p>Arriving in {activeOrder.eta} mins</p>
    </div>

    {/* The Live Map Simulation Block */}
    <div className="live-map-box">
      <div className="rider-marker" style={{ left: `${progress}%` }}>🛵</div>
    </div>

    {/* Status Logs (Newest on top) */}
    <div className="status-timeline">
      {activeOrder.log?.slice().reverse().map((log, i) => (
        <div key={i} className="log-item">
          <span>{log.time}</span> - <strong>{log.msg}</strong>
        </div>
      ))}
    </div>
  </div>
)}