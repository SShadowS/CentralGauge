codeunit 70542 "CG X089 Batch Valuation"
{
    procedure ValueByItem(TemplateName: Code[10]; BatchName: Code[10]): Dictionary of [Code[20], Decimal]
    var
        Item: Record "CG X089 Item";
        JnlLine: Record "CG X089 Journal Line";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        JnlLine.SetRange("Template Name", TemplateName);
        JnlLine.SetRange("Batch Name", BatchName);
        if JnlLine.FindSet() then
            repeat
                Item.Get(JnlLine."Item No.");
                if Totals.ContainsKey(Item."No.") then
                    Totals.Set(Item."No.", Totals.Get(Item."No.") + JnlLine.Quantity * Item."Unit Price")
                else
                    Totals.Add(Item."No.", JnlLine.Quantity * Item."Unit Price");
            until JnlLine.Next() = 0;
        exit(Totals);
    end;
}
