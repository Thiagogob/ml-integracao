--SELECT
--    ml_id,
--    titulo,
--    sku,
--    COUNT(sku) as contagem
--FROM
--    anuncios
--GROUP BY
--    sku
--HAVING
--    COUNT(sku) > 2;

--SELECT
--    ml_id,
--    titulo,
--    sku,
--    categoria
--FROM
--    anuncios
--WHERE
--    sku = 'K76 ARO 14 4/98 B';

SELECT
    ml_id,
    titulo,
    sku,
    marca,
    categoria
FROM
    anuncios
WHERE
    titulo LIKE '%r39%'
    AND
    titulo NOT LIKE '%Calota%'
    --OR
    --sku LIKE '%M6%'
ORDER BY ml_id;


--ARION ARO 19 5/113 SS

--SELECT
--    ml_id,
--    sku,
--    categoria,
--    COUNT(*) as contagem
--FROM
--    anuncios
--GROUP BY
--    sku
--HAVING
--    COUNT(*) > 2;

--SELECT
--    categoria,
--    COUNT(*) as quantidade
--FROM
--    anuncios
--GROUP BY
--    categoria


