codeunit 70253 "CGR Desk Rate Quote"
{
    SingleInstance = true;

    var
        DeskQuotes: Dictionary of [Code[20], Decimal];

    procedure QuoteDeskRate(RateCode: Code[20]): Decimal
    var
        DeskRate: Record "CGR Desk Rate";
        Quote: Decimal;
    begin
        if DeskQuotes.Get(RateCode, Quote) then
            exit(Quote);
        DeskRate.Get(RateCode);
        Quote := QuoteOfRecord(DeskRate);
        DeskQuotes.Add(RateCode, Quote);
        exit(Quote);
    end;

    procedure ForgetDeskQuotes()
    begin
        Clear(DeskQuotes);
    end;

    local procedure QuoteOfRecord(DeskRate: Record "CGR Desk Rate"): Decimal
    begin
        exit(Round(DeskRate."Day Rate" * (100 + DeskRate."Season Surcharge %") / 100, 0.01));
    end;

    local procedure StoreDeskQuote(DeskRate: Record "CGR Desk Rate")
    begin
        DeskQuotes.Set(DeskRate.Code, QuoteOfRecord(DeskRate));
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Desk Rate", 'OnAfterInsertEvent', '', false, false)]
    local procedure OnDeskRateInserted(var Rec: Record "CGR Desk Rate")
    begin
        if Rec.IsTemporary() then
            exit;
        StoreDeskQuote(Rec);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Desk Rate", 'OnAfterModifyEvent', '', false, false)]
    local procedure OnDeskRateModified(var Rec: Record "CGR Desk Rate")
    begin
        if Rec.IsTemporary() then
            exit;
        StoreDeskQuote(Rec);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Desk Rate", 'OnAfterDeleteEvent', '', false, false)]
    local procedure OnDeskRateDeleted(var Rec: Record "CGR Desk Rate")
    begin
        if Rec.IsTemporary() then
            exit;
        if DeskQuotes.ContainsKey(Rec.Code) then
            DeskQuotes.Remove(Rec.Code);
    end;
}
