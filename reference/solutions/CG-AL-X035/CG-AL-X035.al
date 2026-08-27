codeunit 71240 "CG X035 Runner"
{
    Access = Internal;

    procedure TryProcess(No: Integer): Boolean
    var
        Entry: Record "CG X035 Entry";
        Worker: Codeunit "CG X035 Worker";
    begin
        Entry.Init();
        Entry."No." := No;
        Entry.Insert();

        Commit();

        exit(Worker.Run());
    end;
}