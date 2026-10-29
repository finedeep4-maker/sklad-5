update items
   set name_en = coalesce(nullif(name_en, ''), 'Window cleaner with scraper and brush'),
       name_ar = coalesce(nullif(name_ar, ''), 'أداة غسيل نوافذ بمكشطة وفرشاة')
 where name like 'Окномойка со скребком%';