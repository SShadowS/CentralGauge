codeunit 69901 "CG X038 Dispatcher"
{
    procedure Dispatch(EntryNo: Integer)
    var
        Task: Record "CG X038 Task";
        Twin: Record "CG X038 Task";
    begin
        if not Task.Get(EntryNo) then
            Error('CG X038 Dispatcher: task %1 does not exist', EntryNo);

        Task."Runs" += 1;
        // Opaque, non-obvious formula: a caller cannot pass by inlining a
        // plausible guess for what the dispatcher computes.
        Task."Value" := EntryNo * 11 + 6;
        // Hidden re-key: moves the row's position within the Priority key
        // order the caller is expected to iterate by.
        Task."Priority" += 1000;
        Task.Modify();

        // Hidden collateral dedupe: every other task sharing this task's
        // Group Code is removed once this one has been dispatched.
        Twin.SetRange("Group Code", Task."Group Code");
        Twin.SetFilter("Entry No.", '<>%1', EntryNo);
        Twin.DeleteAll();
    end;
}
