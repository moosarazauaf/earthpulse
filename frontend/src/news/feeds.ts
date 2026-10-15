/**
 * The outlets scanned for hazard news. Only their public RSS feeds are read,
 * once an hour; EarthPulse keeps the headline, link and time of matching
 * items, never the article text.
 *
 * `home` is the outlet's own country, used as weak evidence when a headline
 * names a town but not its country ("Floods hit Swat" in a Pakistani paper).
 */
export interface Feed {
  name: string;
  url: string;
  homepage: string;
  home?: string;
}

const BBC = "https://www.bbc.com/news";
const GUARDIAN = "https://www.theguardian.com";

export const FEEDS: Feed[] = [
  // International outlets, including their regional desks, where most disaster reporting appears.
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", homepage: BBC },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml", homepage: BBC },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml", homepage: BBC },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml", homepage: BBC },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", homepage: BBC },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml", homepage: BBC },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", homepage: BBC },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", homepage: BBC },
  { name: "The Guardian", url: "https://www.theguardian.com/world/natural-disasters/rss", homepage: GUARDIAN },
  { name: "The Guardian", url: "https://www.theguardian.com/world/earthquakes/rss", homepage: GUARDIAN },
  { name: "The Guardian", url: "https://www.theguardian.com/world/wildfires/rss", homepage: GUARDIAN },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", homepage: GUARDIAN },
  { name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", homepage: "https://www.nytimes.com" },
  { name: "NPR", url: "https://feeds.npr.org/1004/rss.xml", homepage: "https://www.npr.org" },
  { name: "NBC News", url: "https://feeds.nbcnews.com/nbcnews/public/news", homepage: "https://www.nbcnews.com" },
  { name: "CBS News", url: "https://www.cbsnews.com/latest/rss/world", homepage: "https://www.cbsnews.com" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", homepage: "https://www.aljazeera.com" },
  { name: "DW", url: "https://rss.dw.com/rdf/rss-en-all", homepage: "https://www.dw.com" },
  { name: "France 24", url: "https://www.france24.com/en/rss", homepage: "https://www.france24.com" },
  { name: "Euronews", url: "https://www.euronews.com/rss?level=theme&name=news", homepage: "https://www.euronews.com" },
  { name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml", homepage: "https://news.sky.com" },
  { name: "The Independent", url: "https://www.independent.co.uk/news/world/rss", homepage: "https://www.independent.co.uk" },
  { name: "CBC News", url: "https://www.cbc.ca/webfeed/rss/rss-world", homepage: "https://www.cbc.ca/news" },
  { name: "Xinhua", url: "https://english.news.cn/rss/worldrss.xml", homepage: "https://english.news.cn" },
  { name: "Africanews", url: "https://www.africanews.com/feed/rss", homepage: "https://www.africanews.com" },
  { name: "CNA", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", homepage: "https://www.channelnewsasia.com" },
  // National outlets in hazard-prone countries; `home` is their country.
  { name: "Dawn", url: "https://www.dawn.com/feeds/home", homepage: "https://www.dawn.com", home: "PK" },
  { name: "The Express Tribune", url: "https://www.tribune.com.pk/feed/home", homepage: "https://tribune.com.pk", home: "PK" },
  { name: "Geo News", url: "https://www.geo.tv/rss/1/1", homepage: "https://www.geo.tv", home: "PK" },
  { name: "Hindustan Times", url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml", homepage: "https://www.hindustantimes.com", home: "IN" },
  { name: "NDTV", url: "https://feeds.feedburner.com/ndtvnews-world-news", homepage: "https://www.ndtv.com" },
  { name: "The Kathmandu Post", url: "https://kathmandupost.com/rss", homepage: "https://kathmandupost.com", home: "NP" },
  { name: "The Japan Times", url: "https://www.japantimes.co.jp/feed/", homepage: "https://www.japantimes.co.jp", home: "JP" },
  { name: "Philippine Daily Inquirer", url: "https://newsinfo.inquirer.net/feed", homepage: "https://newsinfo.inquirer.net", home: "PH" },
  { name: "Rappler", url: "https://www.rappler.com/feed/", homepage: "https://www.rappler.com", home: "PH" },
  { name: "Antara", url: "https://en.antaranews.com/rss/news.xml", homepage: "https://en.antaranews.com", home: "ID" },
  { name: "Bangkok Post", url: "https://www.bangkokpost.com/rss/data/topstories.xml", homepage: "https://www.bangkokpost.com", home: "TH" },
  { name: "ABC News (Australia)", url: "https://www.abc.net.au/news/feed/2942460/rss.xml", homepage: "https://www.abc.net.au/news", home: "AU" },
  { name: "RNZ", url: "https://www.rnz.co.nz/rss/national.xml", homepage: "https://www.rnz.co.nz", home: "NZ" },
  { name: "Los Angeles Times", url: "https://www.latimes.com/california/rss2.0.xml", homepage: "https://www.latimes.com", home: "US" },
  { name: "Mexico News Daily", url: "https://mexiconewsdaily.com/feed/", homepage: "https://mexiconewsdaily.com", home: "MX" },
  // Specialist and humanitarian sources.
  { name: "The Watchers", url: "https://watchers.news/feed/", homepage: "https://watchers.news" },
  { name: "UN News", url: "https://news.un.org/feed/subscribe/en/news/topic/climate-change/feed/rss.xml", homepage: "https://news.un.org" },
  { name: "ReliefWeb (UN OCHA)", url: "https://reliefweb.int/disasters/rss.xml", homepage: "https://reliefweb.int" },
  { name: "ReliefWeb (UN OCHA)", url: "https://reliefweb.int/updates/rss.xml", homepage: "https://reliefweb.int" },
];
