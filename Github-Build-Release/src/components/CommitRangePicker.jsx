import { useEffect, useMemo, useRef, useState } from 'react';
import { FaCheck, FaChevronDown, FaSearch } from 'react-icons/fa';

function formatCommitDate(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function CommitRangePicker({
  id,
  label,
  value,
  onChange,
  commits,
  disabled = false,
  placeholder = 'Paste a hash or choose a commit'
}) {
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filteredCommits = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query || commits.some(commit => commit.hash === value)) return commits;

    return commits.filter(commit => {
      const searchableText = [commit.hash, commit.shortHash, commit.message]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [commits, value]);

  useEffect(() => {
    const handlePointerDown = event => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const resolvedActiveIndex = filteredCommits.length
    ? Math.min(activeIndex, filteredCommits.length - 1)
    : -1;

  const selectCommit = commit => {
    onChange(commit.hash);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = event => {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      if (!filteredCommits.length) return;
      setActiveIndex(current => Math.min(current + 1, filteredCommits.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      if (!filteredCommits.length) return;
      setActiveIndex(current => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter' && isOpen && resolvedActiveIndex >= 0 && filteredCommits[resolvedActiveIndex]) {
      event.preventDefault();
      selectCommit(filteredCommits[resolvedActiveIndex]);
      return;
    }

    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const listboxId = `${id}-listbox`;
  const activeOptionId = resolvedActiveIndex >= 0 ? `${id}-option-${resolvedActiveIndex}` : undefined;

  return (
    <div className="commit-select-group" ref={rootRef}>
      <label className="commit-select-label" htmlFor={id}>{label}</label>
      <div className={`commit-combobox ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
        <FaSearch className="commit-combobox-search" size={10} aria-hidden="true" />
        <input
          id={id}
          type="text"
          className="commit-input"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-activedescendant={activeOptionId}
          value={value}
          onChange={event => {
            onChange(event.target.value.trim());
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => !disabled && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className="commit-combobox-toggle"
          onClick={() => {
            setIsOpen(current => !current);
            setActiveIndex(-1);
          }}
          disabled={disabled}
          aria-label={`${isOpen ? 'Close' : 'Open'} ${label} commit list`}
          aria-controls={listboxId}
          aria-expanded={isOpen}
        >
          <FaChevronDown size={10} aria-hidden="true" />
        </button>

        {isOpen && (
          <ul id={listboxId} className="commit-options custom-scrollbar" role="listbox">
            {filteredCommits.length ? filteredCommits.map((commit, index) => {
              const selected = commit.hash === value;
              const active = index === resolvedActiveIndex;

              return (
                <li
                  id={`${id}-option-${index}`}
                  key={commit.hash}
                  className={`commit-option ${selected ? 'selected' : ''} ${active ? 'active' : ''}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectCommit(commit)}
                >
                  <span className="commit-option-check" aria-hidden="true">
                    {selected && <FaCheck size={8} />}
                  </span>
                  <span className="commit-option-content">
                    <span className="commit-option-heading">
                      <code>{commit.shortHash || commit.hash.slice(0, 7)}</code>
                      {formatCommitDate(commit.date) && (
                        <time dateTime={commit.date}>{formatCommitDate(commit.date)}</time>
                      )}
                    </span>
                    <span className="commit-option-message">{commit.message || 'Untitled commit'}</span>
                  </span>
                </li>
              );
            }) : (
              <li className="commit-options-empty" role="option" aria-disabled="true">
                <FaSearch size={11} aria-hidden="true" />
                <span>{commits.length ? 'No matching commits' : 'No commits loaded'}</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CommitRangePicker;
