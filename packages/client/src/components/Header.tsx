import { useState } from 'react';
import '../styles/Header.scss';
import TrashPopup from './TrashPopup';
import Tab from './Tab';
import { useBoardContext } from '../contexts/BoardProvider';
import Icon from './Icon';

const Header = () => {
  const [isTrashPopupOpen, setIsTrashPopupOpen] = useState(false);

  const { boards, isLoading, activeBoardId, handleCreateBoard } = useBoardContext();

  if (isLoading) {
    return <div className="tab-bar-loading">Loading boards...</div>;
  }

  return (
    <div className="header" data-testid="whiteboard-board-list">
      <button className="trash-button" onClick={() => setIsTrashPopupOpen(true)}>
        <Icon name="trash" />
      </button>

      <div className="tab-bar">
        {boards.map(board => (
          <Tab key={board.id} board={board} activeBoardId={activeBoardId} />
        ))}
        <button
          onClick={handleCreateBoard}
          className="create-board-button"
          aria-label="Create new board"
        >
          +
        </button>
      </div>

      <TrashPopup isOpen={isTrashPopupOpen} onClose={() => setIsTrashPopupOpen(false)} />
    </div>
  );
};

export default Header;
