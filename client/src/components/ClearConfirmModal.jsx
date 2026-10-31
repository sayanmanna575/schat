import React from 'react';

export default function ClearConfirmModal({ isOpen, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs px-4">
      <div className="w-full max-w-xs bg-navy-900 border border-navy-700 rounded-xl p-5 shadow-xl text-center animate-in fade-in zoom-in-95 duration-150">
        <h3 className="text-base font-semibold text-white mb-2">
          Clear Chat?
        </h3>
        <p className="text-xs text-slate-400 mb-5">
          This will delete all messages for everyone currently in this room.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-2 text-xs font-medium text-slate-300 bg-navy-800 hover:bg-navy-700 border border-navy-700 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            type="button"
            id="confirm-clear-btn"
            onClick={onConfirm}
            className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition"
          >
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}
