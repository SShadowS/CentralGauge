codeunit 70823 "CG X122 Release Notifier"
{
    // Carries only the release-side subscription, so binding it for the
    // nightly batch cannot also activate a cancellation-alert handler that
    // belongs to a different call site.
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X122 Document Processor", 'OnDocumentReleased', '', false, false)]
    local procedure OnReleased(DocNo: Code[20])
    begin
        LogEntry(DocNo, 'RELEASED');
    end;

    local procedure LogEntry(DocNo: Code[20]; Kind: Code[20])
    var
        Log: Record "CG X122 Activity Log";
    begin
        Log.Init();
        Log."Entry No." := NextEntryNo();
        Log."Doc No." := DocNo;
        Log.Kind := Kind;
        Log.Insert();
    end;

    local procedure NextEntryNo(): Integer
    var
        Log: Record "CG X122 Activity Log";
    begin
        if Log.FindLast() then
            exit(Log."Entry No." + 1);
        exit(1);
    end;
}
