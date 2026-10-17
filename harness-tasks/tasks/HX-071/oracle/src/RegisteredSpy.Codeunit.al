codeunit 86883 "HX071 Registered Spy"
{
    EventSubscriberInstance = Manual;

    var
        RaisedCount: Integer;
        RaisedEntryNo: Integer;

    procedure HX071Raised(): Integer
    begin
        exit(RaisedCount);
    end;

    procedure HX071RaisedEntryNo(): Integer
    begin
        exit(RaisedEntryNo);
    end;

    // Compile-time reference to the kept signatures of CGR Insurer Check; no oracle row runs it.
    procedure HX071KeepCheckSignatures(VehicleNo: Code[20]; Description: Text[100])
    var
        InsurerCheck: Codeunit "CGR Insurer Check";
    begin
        InsurerCheck.SetDamage(VehicleNo, Description);
        InsurerCheck.CheckDamage(VehicleNo, Description);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Damage Mgt", 'OnAfterDamageRegistered', '', false, false)]
    local procedure HandleAfterDamageRegistered(var DamageEntry: Record "CGR Damage Entry")
    begin
        RaisedCount += 1;
        RaisedEntryNo := DamageEntry."Entry No.";
    end;
}
