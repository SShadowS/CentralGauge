codeunit 70118 "CGR Workshop Repair Unit"
{
    var
        EntryNos: List of [Integer];

    procedure SetEntries(NewEntryNos: List of [Integer])
    begin
        EntryNos := NewEntryNos;
    end;

    trigger OnRun()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        foreach EntryNo in EntryNos do
            DamageMgt.RepairDamage(EntryNo);
    end;
}
