import raw from '../../../content/english-multi/manifest.json';
export type MultiEnglishBook={seriesKey:string;publisher:string;series:string;grade:number;volume:number;volumeText:string;editionText:string;sourceUrl:string;contentsUrl:string;vocabularyUrl:string;unitCount:number;sectionCount:number;cardCount:number;seedFile:string;referenceFile:string;resourceId:string};
export const multiEnglishManifest=raw as unknown as {revision:string;compiledAt:string;books:MultiEnglishBook[];gaps:Array<{series:string;reason:string}>};
export function multiEnglishInfo(edition:{subject:string;grade:number;volume:string;publisher?:string;series?:string;editionText?:string;label?:string}){
 if(edition.subject!=='english')return undefined;
 return multiEnglishManifest.books.find(book=>book.grade===edition.grade&&book.volumeText===edition.volume&&(!edition.publisher||book.publisher===edition.publisher)&&(!edition.series||book.series===edition.series)&&(edition.publisher&&edition.series||edition.label?.startsWith(book.publisher+' · '+book.series+' · '))&&(book.editionText===edition.editionText||edition.label?.endsWith(book.editionText)));
}
