codeunit 86642 "HX059 Batch Runner"
{
    var
        EntryNos: List of [Integer];
        SingleEntryNo: Integer;
        RepairSingle: Boolean;

    procedure SetBatch(NewEntryNos: List of [Integer])
    begin
        EntryNos := NewEntryNos;
        RepairSingle := false;
    end;

    procedure SetSingleRepair(EntryNo: Integer)
    begin
        SingleEntryNo := EntryNo;
        RepairSingle := true;
    end;

    trigger OnRun()
    var
        RepairRun: Codeunit "CGR Workshop Repair Run";
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        if RepairSingle then
            DamageMgt.RepairDamage(SingleEntryNo)
        else
            RepairRun.RepairBatch(EntryNos);
    end;
}
