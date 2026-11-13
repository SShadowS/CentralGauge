codeunit 70253 "CGR Desk Rate Quote"
{
    SingleInstance = true;

    var
        DeskQuotes: Dictionary of [Code[20], Decimal];
        TouchedRateCodes: List of [Code[20]];

    procedure QuoteDeskRate(RateCode: Code[20]): Decimal
    var
        DeskRate: Record "CGR Desk Rate";
        Quote: Decimal;
    begin
        if DeskQuotes.Get(RateCode, Quote) then
            exit(Quote);
        DeskRate.Get(RateCode);
        Quote := Round(DeskRate."Day Rate" * (100 + DeskRate."Season Surcharge %") / 100, 0.01);
        // A rate touched in this session may still be rolled back, and memory is not.
        if not TouchedRateCodes.Contains(RateCode) then
            DeskQuotes.Add(RateCode, Quote);
        exit(Quote);
    end;

    procedure ForgetDeskQuotes()
    begin
        Clear(DeskQuotes);
    end;

    local procedure ForgetDeskQuote(RateCode: Code[20])
    begin
        if DeskQuotes.ContainsKey(RateCode) then
            DeskQuotes.Remove(RateCode);
        if not TouchedRateCodes.Contains(RateCode) then
            TouchedRateCodes.Add(RateCode);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Desk Rate", 'OnAfterInsertEvent', '', false, false)]
    local procedure OnDeskRateInserted(var Rec: Record "CGR Desk Rate")
    begin
        if Rec.IsTemporary() then
            exit;
        ForgetDeskQuote(Rec.Code);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Desk Rate", 'OnAfterModifyEvent', '', false, false)]
    local procedure OnDeskRateModified(var Rec: Record "CGR Desk Rate")
    begin
        if Rec.IsTemporary() then
            exit;
        ForgetDeskQuote(Rec.Code);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Desk Rate", 'OnAfterDeleteEvent', '', false, false)]
    local procedure OnDeskRateDeleted(var Rec: Record "CGR Desk Rate")
    begin
        if Rec.IsTemporary() then
            exit;
        ForgetDeskQuote(Rec.Code);
    end;
}
