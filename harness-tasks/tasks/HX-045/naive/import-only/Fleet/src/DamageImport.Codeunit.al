codeunit 70114 "CGR Damage Import"
{
    // Stores the damage lines reported by the workshop system.
    // Lines for unknown vehicles and lines without a description are skipped.
    procedure ImportDamages(var Lines: Record "CGR Damage Entry" temporary): Integer
    var
        Accepted: Record "CGR Damage Entry" temporary;
        DamageEntry: Record "CGR Damage Entry";
        Vehicle: Record "CGR Vehicle";
        BlockSubscriber: Codeunit "CGR Vehicle Block Subscriber";
        Stored: Integer;
    begin
        if Lines.FindSet() then
            repeat
                if Lines.Description <> '' then
                    if Vehicle.Get(Lines."Vehicle No.") then begin
                        Accepted := Lines;
                        Accepted.Insert(true);
                    end;
            until Lines.Next() = 0;

        if Accepted.FindSet() then
            repeat
                Clear(DamageEntry);
                DamageEntry."Vehicle No." := Accepted."Vehicle No.";
                DamageEntry.Description := Accepted.Description;
                DamageEntry."Reported On" := Accepted."Reported On";
                DamageEntry.Repaired := Accepted.Repaired;
                // Plain insert: the workshop's report date and repaired flag are kept as reported.
                DamageEntry.Insert();
                if not DamageEntry.Repaired then
                    BlockSubscriber.BlockForDamage(DamageEntry);
                Stored += 1;
            until Accepted.Next() = 0;
        exit(Stored);
    end;
}
