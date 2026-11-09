codeunit 88361 "HX160 Archive Deleter"
{
    procedure DeleteHX160Entry(EntryNo: Integer; RunTrigger: Boolean)
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Get(EntryNo);
        DamageEntry.Delete(RunTrigger);
    end;

    procedure DeleteHX160Entries(EntryFilter: Text; RunTrigger: Boolean)
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.SetFilter("Entry No.", EntryFilter);
        DamageEntry.DeleteAll(RunTrigger);
    end;

    procedure DeleteHX160Vehicle(VehicleNo: Code[20]; RunTrigger: Boolean)
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll(RunTrigger);
    end;
}
