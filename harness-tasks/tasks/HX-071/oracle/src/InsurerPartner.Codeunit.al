codeunit 86881 "HX071 Insurer Partner"
{
    EventSubscriberInstance = Manual;

    var
        Modes: Dictionary of [Code[20], Integer];
        Markers: Dictionary of [Code[20], Code[20]];
        RefusalText: Text;
        CallCount: Integer;
        MarkersQueued: Integer;
        LastVehicleNo: Code[20];
        LastDescription: Text;
        StoredAtLastCall: Integer;
        RefusedErr: Label 'HX071 insurer refused %1.', Comment = '%1 = vehicle number';

    // Mode: 0 accept, 1 accept and queue the marker, 2 refuse, 3 queue the marker then refuse, 4 refuse with the long text.
    procedure SetHX071Mode(VehicleNo: Code[20]; Mode: Integer; MarkerNo: Code[20])
    begin
        Modes.Set(VehicleNo, Mode);
        Markers.Set(VehicleNo, MarkerNo);
    end;

    procedure SetHX071RefusalText(NewRefusalText: Text)
    begin
        RefusalText := NewRefusalText;
    end;

    procedure HX071Calls(): Integer
    begin
        exit(CallCount);
    end;

    procedure HX071MarkersQueued(): Integer
    begin
        exit(MarkersQueued);
    end;

    procedure HX071LastVehicle(): Code[20]
    begin
        exit(LastVehicleNo);
    end;

    procedure HX071LastDescription(): Text
    begin
        exit(LastDescription);
    end;

    procedure HX071StoredAtCall(): Integer
    begin
        exit(StoredAtLastCall);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Insurer Check", 'OnCheckInsuredDamage', '', false, false)]
    local procedure HandleCheckInsuredDamage(VehicleNo: Code[20]; Description: Text[100])
    var
        DamageEntry: Record "CGR Damage Entry";
        Facade: Codeunit "CGR Integration Facade";
        Mode: Integer;
    begin
        CallCount += 1;
        LastVehicleNo := VehicleNo;
        LastDescription := Description;
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        StoredAtLastCall := DamageEntry.Count();
        if not Modes.Get(VehicleNo, Mode) then
            exit;
        if Mode in [1, 3] then begin
            Facade.QueueVehicleCheckedOut(Markers.Get(VehicleNo));
            MarkersQueued += 1;
        end;
        case Mode of
            2, 3:
                Error(RefusedErr, VehicleNo);
            4:
                Error(RefusalText);
        end;
    end;
}
