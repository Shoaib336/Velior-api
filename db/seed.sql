-- Velior: starter data for a fresh database (run after schema.sql).

INSERT INTO products (slug, name, audience, is_set, stock) VALUES ('ambron', 'Ambron By Velior', 'unisex', 0, 10);
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '50 ML', 2800, 2500 FROM products WHERE slug = 'ambron';
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '30 ML', 2000, 1800 FROM products WHERE slug = 'ambron';
INSERT INTO products (slug, name, audience, is_set, stock) VALUES ('ocevian', 'Ocevian By Velior', 'men', 0, 10);
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '50 ML', 2200, 2000 FROM products WHERE slug = 'ocevian';
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '30 ML', 1600, 1450 FROM products WHERE slug = 'ocevian';
INSERT INTO products (slug, name, audience, is_set, stock) VALUES ('magnus', 'Magnus By Velior', 'men', 0, 10);
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '50 ML', 2899, 2699 FROM products WHERE slug = 'magnus';
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '30 ML', 2099, 1899 FROM products WHERE slug = 'magnus';
INSERT INTO products (slug, name, audience, is_set, stock) VALUES ('celestia', 'Celestia By Velior', 'women', 0, 10);
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '50 ML', 2999, 2799 FROM products WHERE slug = 'celestia';
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '30 ML', 2199, 1999 FROM products WHERE slug = 'celestia';
INSERT INTO products (slug, name, audience, is_set, stock) VALUES ('sylvie', 'Sylvie By Velior', 'women', 0, 10);
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '50 ML', 2899, 2699 FROM products WHERE slug = 'sylvie';
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '30 ML', 2099, 1899 FROM products WHERE slug = 'sylvie';
INSERT INTO products (slug, name, audience, is_set, stock) VALUES ('tester-set', 'Tester Set By Velior', 'unisex', 1, 10);
INSERT INTO product_sizes (product_id, label, price, sale_price) SELECT id, '5 x 5 ML', 1900, 1599 FROM products WHERE slug = 'tester-set';

INSERT INTO promo_codes (code, discount_rate) VALUES ('FIRST10', 0.100);

-- Card text, notes, images and product-page content for the seeded catalogue.

UPDATE products SET excerpt = 'Opening with a captivating blend of rich Saffron and sweet Jasmine, Ambron is a magnetic unisex scent crafted for those who command attention.',
  notes = '["Saffron","Jasmine","Amberwood","Fir Resin","Cedarwood"]',
  images = '{"card":"/uploads/seed/ambron/card.webp","portrait":"/uploads/seed/ambron/portrait.webp","gallery":["/uploads/seed/ambron/gallery-1.webp","/uploads/seed/ambron/gallery-2.webp","/uploads/seed/ambron/gallery-3.webp"]}',
  detail = '{"description":"Opening with a captivating blend of rich Saffron and sweet Jasmine, Ambron is a magnetic unisex scent crafted for those who command attention. Its deep heart of Amberwood, Fir, and Cedar Wood creates a warm, long-lasting aura with a truly sophisticated trail, evolving smoothly into an opulent, memorable finish.","highlights":{"bestFor":"Evening gatherings, formal events, and cool-weather wear.","scentVibe":"Warm, spicy, and deeply magnetic with an intriguing depth.","keyHighlights":"Exceptional unisex projection with a rich, woody-spicy trail."},"specs":{"top":"Saffron, Jasmine","heart":"Amberwood","base":"Fir Resin, Cedarwood","longevity":"Moderate / Long Lasting","type":"Eau De Parfum","sillage":"Strong and Elegant"}}'
WHERE slug = 'ambron';

UPDATE products SET excerpt = 'Driven by crisp citrus and light aromatics, Ocevian delivers an invigorating burst of freshness tailored for the active man.',
  notes = '["Crisp Citrus","Light Aromatics","Clean Woods"]',
  images = '{"card":"/uploads/seed/ocevian/card.webp","portrait":"/uploads/seed/ocevian/portrait.webp","gallery":["/uploads/seed/ocevian/gallery-1.webp","/uploads/seed/ocevian/gallery-2.webp","/uploads/seed/ocevian/gallery-3.webp"]}',
  detail = '{"description":"Driven by crisp citrus and light aromatics, Ocevian delivers an invigorating burst of freshness tailored for the active man. Grounded by clean, smooth woods, this sporty fragrance leaves an effortless, energetic impression throughout the day, providing a subtle yet uplifting trail that keeps you feeling revived and dynamic.","highlights":{"bestFor":"Daily wear, workdays, and warm-weather freshness.","scentVibe":"Crisp, clean, and energising with a sporty lift.","keyHighlights":"Effortless all-day freshness with a smooth woody base."},"specs":{"top":"Crisp Citrus","heart":"Light Aromatics","base":"Clean Woods","longevity":"Moderate","type":"Eau De Parfum","sillage":"Fresh and Uplifting"}}'
WHERE slug = 'ocevian';

UPDATE products SET excerpt = 'A confident citrus-and-wood signature finished with refined musk, Magnus is built for everyday wear that still turns heads.',
  notes = '["Citrus Blend","Smooth Woods","Refined Musk"]',
  images = '{"card":"/uploads/seed/magnus/card.webp","portrait":"/uploads/seed/magnus/portrait.webp","gallery":["/uploads/seed/magnus/gallery-1.webp","/uploads/seed/magnus/gallery-2.webp","/uploads/seed/magnus/gallery-3.webp"]}',
  detail = '{"description":"Magnus opens with a dynamic citrus blend before settling into smooth woods and refined musks. Built for the confident man, this commanding, long-lasting fragrance delivers a fresh yet powerfully masculine signature that subtly commands any room, leaving a distinguished and memorable impression behind.","highlights":{"bestFor":"Business meetings, formal occasions, and evening wear.","scentVibe":"Powerful, refined, and fresh with a strong woody undertone.","keyHighlights":"High-impact longevity with a bold, commanding sillage."},"specs":{"top":"Citrus Blend","heart":"Smooth Woods","base":"Refined Musks","longevity":"Long Lasting","type":"Eau De Parfum","sillage":"Fresh and Commanding"}}'
WHERE slug = 'magnus';

UPDATE products SET excerpt = 'An irresistible fusion of rich Coffee and warm Vanilla, Celestia is a bold feminine fragrance that instantly captivates.',
  notes = '["Vanilla","Coffee","Warm Florals","Soft Musks"]',
  images = '{"card":"/uploads/seed/celestia/card.webp","portrait":"/uploads/seed/celestia/portrait.webp","gallery":["/uploads/seed/celestia/gallery-1.webp","/uploads/seed/celestia/gallery-2.webp","/uploads/seed/celestia/gallery-3.webp"]}',
  detail = '{"description":"An irresistible fusion of rich Coffee and warm Vanilla, Celestia is a bold feminine fragrance that instantly captivates. Soft musks and subtle florals round out this luxurious scent, creating a seamlessly smooth transition from a fiery initial spritz to a velvety, intimate dry-down. Designed for the modern woman who leaves a lasting impression, it offers an alluring presence that radiates elegance throughout the night.","highlights":{"bestFor":"Memorable evenings, romantic dates, and special occasions.","scentVibe":"Warm, sweet, and deeply sensual with a luxurious finish.","keyHighlights":"Exceptional longevity with a bold, captivating sillage."},"specs":{"top":"Vanilla, Coffee","heart":"Warm Florals","base":"Soft Musks","longevity":"Long Lasting","type":"Eau De Parfum","sillage":"Bold & Captivating"}}'
WHERE slug = 'celestia';

UPDATE products SET excerpt = 'Sylvie pairs bright citrus and fresh Peony with a deep, grounding base of Sandalwood and Patchouli, designed for the modern woman.',
  notes = '["Peony","Mandarin","Citrusy Freshness","Sandalwood","Patchouli"]',
  images = '{"card":"/uploads/seed/sylvie/card.webp","portrait":"/uploads/seed/sylvie/portrait.webp","gallery":["/uploads/seed/sylvie/gallery-1.webp","/uploads/seed/sylvie/gallery-2.webp","/uploads/seed/sylvie/gallery-3.webp"]}',
  detail = '{"description":"Sylvie pairs bright citrus and fresh Peony with a deep, grounding base of Sandalwood and Patchouli. Designed for the modern woman, this long-lasting Eau De Parfum delivers an elegant, floral charm that feels both timeless and vibrant, seamlessly wrapping you in a graceful, uplifting aura that lasts all day.","highlights":{"bestFor":"Daily elegance, daytime outings, and spring/summer events.","scentVibe":"Bright, floral, and sophisticated with a smooth woody base.","keyHighlights":"Long-lasting floral freshness with a refined, graceful presence."},"specs":{"top":"Peony, Mandarin","heart":"Sandalwood, Patchouli","base":"Citrusy, Freshness","longevity":"Long Lasting","type":"Eau De Parfum","sillage":"Elegant and Floral"}}'
WHERE slug = 'sylvie';

UPDATE products SET excerpt = 'Designed for those who refuse to settle on just one signature scent, our exclusive Discovery Set lets you sample the full Velior range before you commit to a full bottle.',
  notes = '["Ambron","Ocevian","Magnus","Celestia","Sylvie"]',
  images = '{"card":"/uploads/seed/tester-set/card.webp","portrait":null,"gallery":["/uploads/seed/tester-set/gallery-1.webp","/uploads/seed/tester-set/gallery-2.webp","/uploads/seed/tester-set/gallery-3.webp"]}',
  detail = '{"description":"Designed for those who refuse to settle on just one signature scent, our exclusive Discovery Set features 5ml mini bottles of all 5 luxury Eau De Parfums—Ambron, Sylvie, Ocevian, Celestia, and Magnus. Expertly curated to let you experience our full olfactory range, this compact travel collection allows you to explore, layer, and find your perfect fragrance for every mood, season, and occasion before committing to a full-sized bottle.","highlights":{"bestFor":"First-time buyers, travel, daily rotation, and gifting.","scentVibe":"Versatile, luxurious, and complete—covering fresh, warm, floral, and woody profiles.","keyHighlights":"Includes 5 x 5ml high-concentration EDP atomizers with 10+ hours of long-lasting wear."},"specs":{"top":"","heart":"","base":"","longevity":"","type":"","sillage":""}}'
WHERE slug = 'tester-set';

-- Review cards and FAQs the storefront shipped with.

INSERT INTO testimonials (name, text, reviewed_at, featured) VALUES
  ('Mohammad Oudaoud', 'Ordered Ambron as a gift and ended up buying one for myself too. The scent lasted the entire day and the packaging felt genuinely premium.', DATE_SUB(CURDATE(), INTERVAL 6 MONTH), 1),
  ('Ahmad Hassan', 'Ambron scent is long-lasting! Lasts easily for more than 10 hours. Truly amazing quality.', DATE_SUB(CURDATE(), INTERVAL 2 MONTH), 1),
  ('Sarah Khan', 'Celestia is my new favorite vanilla fragrance. Highly recommended for daily wear!', DATE_SUB(CURDATE(), INTERVAL 1 MONTH), 1),
  ('Zubair Ali', 'Ocevian fragrance is super fresh and masculine. Quick delivery in Lahore.', DATE_SUB(CURDATE(), INTERVAL 3 WEEK), 1),
  ('Fatima Zahra', 'Sylvie perfume pairs perfectly with evening outfits. Elegant projection.', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 1),
  ('Usman Tariq', 'Magnus perfume is powerful and commanding. Will order again soon!', DATE_SUB(CURDATE(), INTERVAL 1 WEEK), 1),
  ('Bilal Ahmed', 'Superb quality Eau De Parfum. Smells luxury without breaking the bank.', DATE_SUB(CURDATE(), INTERVAL 4 MONTH), 1),
  ('Hina Malik', 'Authentic oils used. Doesn''t fade even in hot summer weather.', DATE_SUB(CURDATE(), INTERVAL 2 WEEK), 1),
  ('Hamza Raza', 'Great customer support and extremely safe bubble wrap packaging.', DATE_SUB(CURDATE(), INTERVAL 3 MONTH), 1),
  ('Ayesha Omer', 'Sweet Jasmine and Saffron blend in Ambron is pure perfection.', DATE_SUB(CURDATE(), INTERVAL 1 MONTH), 1),
  ('Omar Farooq', 'Fast shipping to Karachi. The bottle design feels so heavy and high-end.', DATE_SUB(CURDATE(), INTERVAL 2 MONTH), 1),
  ('Sana Tariq', 'Loved the unisex range! Gifted it to my brother and he loved it.', DATE_SUB(CURDATE(), INTERVAL 3 WEEK), 1);

INSERT INTO faqs (id, category, question, answer, sort_order) VALUES
  (1, 'Product', 'How long do Velior fragrances last on skin and clothes?', 'Our Eau De Parfums are blended with high-concentration perfume oils, engineered to deliver exceptional longevity of 10+ hours on skin and even longer on fabrics.', 1),
  (2, 'Product', 'What is the concentration level of your perfumes?', 'All Velior fragrances are crafted at Eau De Parfum (EDP) concentration grade, ensuring a richer, deeper scent profile with strong projection compared to standard spray colognes.', 2),
  (3, 'Product', 'Are Velior fragrances unisex?', 'We offer scents tailored for everyone. While Ambron is designed as a signature unisex fragrance, Sylvie and Celestia are crafted for women, and Ocevian and Magnus are tailored for men.', 3),
  (4, 'Product', 'Are your products cruelty-free and skin-safe?', 'Yes. All our perfumes are 100% authentic, ethically produced, cruelty-free, and formulated using premium-grade ingredients safe for daily wear.', 4),
  (5, 'Discovery', 'I''m unsure which scent suits me best. What do you recommend?', 'We recommend starting with the Velior Discovery Set (5 x 5ml). It contains mini spray atomizers of all 5 signature scents so you can test and explore each fragrance on your skin before committing to a full-sized bottle.', 5),
  (6, 'Shipping', 'How long does shipping take?', 'Standard nationwide delivery takes 3 to 5 business days. Once your order is dispatched, you will receive an SMS and email notification with your tracking details.', 6),
  (7, 'Shipping', 'What are your delivery charges?', 'We offer nationwide shipping across Pakistan. Delivery fees are calculated at checkout, and we frequently offer Free Delivery on orders above specific cart values or promotional bundles.', 7),
  (8, 'Payments', 'What payment methods do you accept?', 'We primarily offer Cash on Delivery (COD) for convenient payment upon receipt. We also accept direct bank transfers and online card payments.', 8),
  (9, 'Payments', 'Can I change or cancel my order after placing it?', 'You can request changes or cancellations within 12 hours of placing your order by contacting our support team via WhatsApp or email before your package is dispatched.', 9),
  (10, 'Payments', 'What should I do if my parcel arrives damaged?', 'If your package arrives damaged or leaks during transit, please contact our support team within 48 hours with photo/video proof, and we will issue a free replacement immediately.', 10);
