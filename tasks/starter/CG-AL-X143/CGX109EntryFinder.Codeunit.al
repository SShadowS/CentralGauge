codeunit 70691 "CG X109 Entry Finder"
{
    procedure FindLatest(DocumentNo: Code[20]; var ActivityEntry: Record "CG X109 Activity Entry"): Boolean
    begin
        ActivityEntry.SetRange("Document No.", DocumentNo);
        exit(ActivityEntry.FindLast());
    end;
}
