import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrashBoard } from '../types/types';
import { BoardService } from '../services/boardService';
import '../styles/TrashPopup.scss';
import { useBoardContext } from '../contexts/BoardProvider';
import Icon from './Icon';
import logger from '../utils/logger';

interface TrashPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

const TrashPopup = ({ onClose, isOpen }: TrashPopupProps) => {
  const [trashedBoards, setTrashedBoards] = useState<TrashBoard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { fetchBoards } = useBoardContext();
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
      fetchTrashedBoards();
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, onClose]);

  const fetchTrashedBoards = async () => {
    try {
      setIsLoading(true);
      const data = await BoardService.getTrashedBoards();
      setTrashedBoards(data);
    } catch (error) {
      setError('Error connecting to server');
      logger.error('Error fetching trashed boards:', error, true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async (boardId: string) => {
    try {
      await BoardService.restoreBoard(boardId);
      setTrashedBoards(prev => prev.filter(board => board.id !== boardId));
      fetchBoards();
      navigate(`/board/${boardId}`);
    } catch (error) {
      setError('Error connecting to server');
      logger.error('Error restoring board:', error, true);
    }
  };

  const handlePermanentDelete = async (boardId: string) => {
    if (
      !window.confirm(
        'Are you sure you want to permanently delete this board? This action cannot be undone.'
      )
    ) {
      return;
    }

    try {
      await BoardService.permanentlyDeleteBoard(boardId);
      setTrashedBoards(prev => prev.filter(board => board.id !== boardId));
    } catch (error) {
      setError('Error connecting to server');
      logger.error('Error deleting board:', error, true);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (!isOpen) return null;

  if (isLoading) {
    return (
      <div className="trash-popup">
        <div className="trash-popup-content">
          <h2>Loading trashed boards...</h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trash-popup">
        <div className="trash-popup-content">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/')}>Return to Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="trash-popup" ref={popupRef}>
      <div className="trash-popup-header">
        <h2>Trashed Boards</h2>
        <button className="trash-popup-close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="trash-popup-content">
        {trashedBoards.length === 0 ? (
          <p>No trashed boards found.</p>
        ) : (
          trashedBoards.map(board => (
            <div key={board.id} className="trash-popup-item">
              <div>
                <h3 className="trash-popup-item-name">{board.name}</h3>
                <p className="trash-popup-item-date">Deleted on: {formatDate(board.updated_at)}</p>
              </div>
              <div className="trash-popup-item-actions">
                <button
                  className="trash-popup-item-action-button button-restore"
                  onClick={() => handleRestore(board.id)}
                >
                  Restore
                </button>
                <button
                  className="trash-popup-item-action-button button-delete"
                  onClick={() => handlePermanentDelete(board.id)}
                >
                  Delete Permanently
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TrashPopup;
