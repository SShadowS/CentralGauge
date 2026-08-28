codeunit 70934 "CG X133 Display Row Builder"
{
    procedure BuildRows(TeamCode: Code[20]; var DisplayRow: Record "CG X133 Display Row" temporary)
    var
        Assignment: Record "CG X133 Assignment";
    begin
        DisplayRow.SetRange("Team Code", TeamCode);
        DisplayRow.DeleteAll();

        Assignment.SetRange("Team Code", TeamCode);
        if Assignment.FindSet() then
            repeat
                DisplayRow.Init();
                DisplayRow."Assignment No." := Assignment."No.";
                DisplayRow."Team Code" := Assignment."Team Code";
                DisplayRow.Priority := Assignment.Priority;
                DisplayRow."Owner Display" := GetOwnerDisplay(Assignment."Owner Code", Assignment."Team Code");
                DisplayRow."Team Display" := GetTeamDisplay(Assignment."Owner Code", Assignment."Team Code");
                DisplayRow.Insert();
            until Assignment.Next() = 0;
    end;

    local procedure GetOwnerDisplay(OwnerCode: Code[20]; TeamCode: Code[20]): Text[100]
    var
        OwnerDisplay: Text[100];
        TeamDisplay: Text[100];
    begin
        OnResolveDisplayContext(OwnerCode, TeamCode, OwnerDisplay, TeamDisplay);
        exit(OwnerDisplay);
    end;

    local procedure GetTeamDisplay(OwnerCode: Code[20]; TeamCode: Code[20]): Text[100]
    var
        OwnerDisplay: Text[100];
        TeamDisplay: Text[100];
    begin
        OnResolveDisplayContext(OwnerCode, TeamCode, OwnerDisplay, TeamDisplay);
        exit(TeamDisplay);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnResolveDisplayContext(OwnerCode: Code[20]; TeamCode: Code[20]; var OwnerDisplay: Text[100]; var TeamDisplay: Text[100])
    begin
    end;
}
