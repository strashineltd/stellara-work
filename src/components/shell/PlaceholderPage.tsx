import { Icon, type IconName } from '../Icon';

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon?: IconName;
  onBackHome?: () => void;
}

export function PlaceholderPage({ title, description, icon = 'list', onBackHome }: PlaceholderPageProps) {
  return (
    <main className="placeholder-page" data-motion="page-enter">
      <span className="placeholder-page__icon"><Icon name={icon} size={20} /></span>
      <h1>{title}</h1>
      <p>{description}</p>
      {onBackHome && (
        <button className="btn btn-secondary" type="button" onClick={onBackHome}>
          返回首页
        </button>
      )}
    </main>
  );
}
