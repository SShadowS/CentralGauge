codeunit 70934 "CG X133 Display Row Builder"
{
    procedure BuildRows(TeamCode: Code[20]; var DisplayRow: Record "CG X133 Display Row" temporary)
    var
        Assignment: Record "CG X133 Assignment";
        Person: Record "CG X133 Person";
        Team: Record "CG X133 Team";
        OwnerDisplays: Dictionary of [Code[20], Text[100]];
        TeamDisplays: Dictionary of [Code[20], Text[100]];
        ResolvedOwnerDisplay: Text[100];
        ResolvedTeamDisplay: Text[100];
    begin
        DisplayRow.SetRange("Team Code", TeamCode);
        DisplayRow.DeleteAll();

        Assignment.SetRange("Team Code", TeamCode);
        if not Assignment.FindSet() then
            exit;

        if Person.FindSet() then
            repeat
                OwnerDisplays.Add(Person."Code", Person."Display Name");
            until Person.Next() = 0;

        if Team.FindSet() then
            repeat
                TeamDisplays.Add(Team."Code", Team."Display Name");
            until Team.Next() = 0;

        repeat
            ResolvedOwnerDisplay := '';
            if OwnerDisplays.ContainsKey(Assignment."Owner Code") then
                ResolvedOwnerDisplay := OwnerDisplays.Get(Assignment."Owner Code");
            ResolvedTeamDisplay := '';
            if TeamDisplays.ContainsKey(Assignment."Team Code") then
                ResolvedTeamDisplay := TeamDisplays.Get(Assignment."Team Code");

            DisplayRow.Init();
            DisplayRow."Assignment No." := Assignment."No.";
            DisplayRow."Team Code" := Assignment."Team Code";
            DisplayRow.Priority := Assignment.Priority;
            DisplayRow."Owner Display" := ResolvedOwnerDisplay;
            DisplayRow."Team Display" := ResolvedTeamDisplay;
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
