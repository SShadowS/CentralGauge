codeunit 71535 "CG X169 Batch Pricer"
{
    procedure PriceBatch(BatchNo: Code[20]; var PricedLine: Record "CG X169 Priced Line" temporary)
    var
        BatchLine: Record "CG X169 Batch Line";
        Setup: Record "CG X169 Pricing Setup";
        Item: Record "CG X169 Item";
        PriceRule: Record "CG X169 Price Rule";
        ItemCost: Dictionary of [Code[20], Decimal];
        ItemGroup: Dictionary of [Code[20], Code[20]];
        GroupMarkup: Dictionary of [Code[20], Decimal];
        MarkupPct: Decimal;
        UnitPrice: Decimal;
    begin
        PricedLine.SetRange("Batch No.", BatchNo);
        PricedLine.DeleteAll();

        Setup.Get('SETUP');

        if Item.FindSet() then
            repeat
                ItemCost.Add(Item."No.", Item."Unit Cost");
                ItemGroup.Add(Item."No.", Item."Price Group");
            until Item.Next() = 0;

        if PriceRule.FindSet() then
            repeat
                GroupMarkup.Add(PriceRule."Price Group", PriceRule."Markup Pct");
            until PriceRule.Next() = 0;

        BatchLine.SetRange("Batch No.", BatchNo);
        if BatchLine.FindSet() then
            repeat
                if ItemCost.ContainsKey(BatchLine."Item No.") then begin
                    MarkupPct := 0;
                    if GroupMarkup.ContainsKey(ItemGroup.Get(BatchLine."Item No.")) then
                        MarkupPct := GroupMarkup.Get(ItemGroup.Get(BatchLine."Item No."));

                    UnitPrice := Round(ItemCost.Get(BatchLine."Item No.") * (1 + (Setup."Base Margin Pct" + MarkupPct) / 100), Setup."Rounding Precision");

                    PricedLine.Init();
                    PricedLine."Batch No." := BatchLine."Batch No.";
                    PricedLine."Line No." := BatchLine."Line No.";
                    PricedLine."Unit Price" := UnitPrice;
                    PricedLine."Line Amount" := UnitPrice * BatchLine.Quantity;
                    PricedLine.Insert();
                end;
            until BatchLine.Next() = 0;
    end;
}
