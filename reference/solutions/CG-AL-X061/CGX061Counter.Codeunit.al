codeunit 71480 "CG X061 Counter"
{
    Access = Internal;

    procedure TaskCountOf(ProjectCode: Code[20]): Integer
    var
        Project: Record "CG X061 Project";
    begin
        if not Project.Get(ProjectCode) then
            exit(0);

        // The row is already in the buffer, so the FlowField must be
        // calculated explicitly.
        Project.CalcFields("Task Count");
        exit(Project."Task Count");
    end;
}
