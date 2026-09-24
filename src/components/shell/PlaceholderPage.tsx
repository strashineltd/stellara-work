import { Icon, type IconName } from '../Icon';

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon?: IconName;
  onBackHome?: () => void;
}

export function PlaceholderPage({ title, description, icon = 'list', onBackHome }: PlaceholderPageProps) {
  return (
    <main className="placeholder-page" data-motion="page-enter" data-page="placeholder">
      <header className="placeholder-page__header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <div className="placeholder-page__content">
        <section className="placeholder-page__empty" aria-labelledby="placeholder-empty-title">
          <span className="placeholder-page__icon"><Icon name={icon} size={22} /></span>
          <h2 id="placeholder-empty-title">暂无可显示的内容</h2>
          <p>连接项目服务后，内容会显示在这里。</p>
          {onBackHome && (
            <button className="btn btn-secondary" type="button" onClick={onBackHome}>
              返回首页
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
