codeunit 80123 "CGR Overview Partner"
{
    EventSubscriberInstance = Manual;

    var
        NotedVehicleNo: Code[20];
        SkippedVehicleNo: Code[20];
        NotedOpenDamages: Integer;
        NotedOldestDamage: Date;
        NotedBlocked: Boolean;
        PartnerCalls: Integer;

    procedure SetPartnerVehicles(NoteVehicleNo: Code[20]; SkipVehicleNo: Code[20])
    begin
        NotedVehicleNo := NoteVehicleNo;
        SkippedVehicleNo := SkipVehicleNo;
    end;

    procedure PartnerCallCount(): Integer
    begin
        exit(PartnerCalls);
    end;

    procedure SeenOpenDamages(): Integer
    begin
        exit(NotedOpenDamages);
    end;

    procedure SeenOldestDamage(): Date
    begin
        exit(NotedOldestDamage);
    end;

    procedure SeenBlockedFlag(): Boolean
    begin
        exit(NotedBlocked);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Damage Overview", 'OnAfterFillOverviewLine', '', false, false)]
    local procedure AdjustOverviewLine(var OverviewLine: Record "CGR Damage Overview Line"; var Skip: Boolean)
    begin
        PartnerCalls += 1;
        if OverviewLine."Vehicle No." = NotedVehicleNo then begin
            NotedOpenDamages := OverviewLine."Open Damages";
            NotedOldestDamage := OverviewLine."Oldest Open Damage";
            NotedBlocked := OverviewLine.Blocked;
            OverviewLine.Note := 'checked';
        end;
        if OverviewLine."Vehicle No." = SkippedVehicleNo then
            Skip := true;
    end;
}
