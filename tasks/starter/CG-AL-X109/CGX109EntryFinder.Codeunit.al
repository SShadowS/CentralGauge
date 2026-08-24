codeunit 70691 "CG X109 Entry Finder"
{
    procedure FindLatest(DocumentNo: Code[20]; var ActivityEntry: Record "CG X109 Activity Entry"): Boolean
    var
        Candidate: Record "CG X109 Activity Entry";
        Found: Boolean;
    begin
        Candidate.SetRange("Document No.", DocumentNo);
        if Candidate.FindSet() then
            repeat
                if not Found or (Candidate."Entry No." > ActivityEntry."Entry No.") then begin
                    ActivityEntry := Candidate;
                    Found := true;
                end;
            until Candidate.Next() = 0;
        exit(Found);
    end;
}
