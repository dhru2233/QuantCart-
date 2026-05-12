import React, { useEffect, useState } from 'react';

const LiveMap = ({ srcPos, destPos, isDelivered }) => {
  const [riderPos, setRiderPos] = useState(srcPos);

  useEffect(() => {
    if (isDelivered) {
      setRiderPos(destPos);
      return;
    }

    // Systematic interpolation logic
    const steps = 50;
    let currentStep = 0;

    const interval = setInterval(() => {
      if (currentStep >= steps) {
        clearInterval(interval);
        return;
      }

      currentStep++;
      // Linear Interpolation (LERP) formula
      const lat = srcPos.lat + (destPos.lat - srcPos.lat) * (currentStep / steps);
      const lng = srcPos.lng + (destPos.lng - srcPos.lng) * (currentStep / steps);

      setRiderPos({ lat, lng });
    }, 1000); // Update position every second

    return () => clearInterval(interval);
  }, [srcPos, destPos, isDelivered]);

  return (
    <div className="map-container">
      {/* Logic to render Map markers at srcPos, destPos, and riderPos */}
      <div className="rider-marker" style={{ left: `${riderPos.lng}%`, top: `${riderPos.lat}%` }}>
        🛵
      </div>
    </div>
  );
};