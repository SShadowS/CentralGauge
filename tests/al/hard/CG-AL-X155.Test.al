codeunit 89375 "CG-AL-X155 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (SOAP
    // runner), so every test clears all three tables before seeding its own
    // rows.

    local procedure SeedDirect(UserCode: Code[20]; AreaCode: Code[20]; Level: Enum "CG X155 Restriction Level")
    var
        UserRestriction: Record "CG X155 User Restriction";
    begin
        UserRestriction.Init();
        UserRestriction."User Code" := UserCode;
        UserRestriction."Area Code" := AreaCode;
        UserRestriction."Restriction Level" := Level;
        UserRestriction.Insert();
    end;

    local procedure SeedMembership(UserCode: Code[20]; GroupCode: Code[20])
    var
        GroupMember: Record "CG X155 Group Member";
    begin
        GroupMember.Init();
        GroupMember."User Code" := UserCode;
        GroupMember."Group Code" := GroupCode;
        GroupMember.Insert();
    end;

    local procedure SeedGroupRule(GroupCode: Code[20]; AreaCode: Code[20]; Level: Enum "CG X155 Restriction Level")
    var
        GroupRestriction: Record "CG X155 Group Restriction";
    begin
        GroupRestriction.Init();
        GroupRestriction."Group Code" := GroupCode;
        GroupRestriction."Area Code" := AreaCode;
        GroupRestriction."Restriction Level" := Level;
        GroupRestriction.Insert();
    end;

    [Test]
    procedure DirectRestrictionAppliesWithNoGroupMembership()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedDirect('USERA', 'AREAA', Enum::"CG X155 Restriction Level"::ReadOnly);

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::ReadOnly.AsInteger(),
            Resolver.GetEffectiveRestriction('USERA', 'AREAA').AsInteger(),
            'A user with only a direct restriction and no group membership must see that restriction');
    end;

    [Test]
    procedure GroupOnlyRestrictionAppliesWithNoDirectRule()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedMembership('USERB', 'GROUPX');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Blocked.AsInteger(),
            Resolver.GetEffectiveRestriction('USERB', 'AREAA').AsInteger(),
            'A user restricted only through a group must see that group''s restriction, not Unrestricted');
    end;

    [Test]
    procedure StrictestOfMultipleGroupsWins()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedMembership('USERC', 'GROUPX');
        SeedMembership('USERC', 'GROUPY');
        SeedMembership('USERC', 'GROUPZ');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::Unrestricted);
        SeedGroupRule('GROUPY', 'AREAA', Enum::"CG X155 Restriction Level"::ReadOnly);
        SeedGroupRule('GROUPZ', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Blocked.AsInteger(),
            Resolver.GetEffectiveRestriction('USERC', 'AREAA').AsInteger(),
            'A user in several groups must see the strictest restriction among all of them');
    end;

    [Test]
    procedure TiedGroupRestrictionsDoNotEscalateBeyondTheirLevel()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedMembership('USERD', 'GROUPX');
        SeedMembership('USERD', 'GROUPY');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::ReadOnly);
        SeedGroupRule('GROUPY', 'AREAA', Enum::"CG X155 Restriction Level"::ReadOnly);

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::ReadOnly.AsInteger(),
            Resolver.GetEffectiveRestriction('USERD', 'AREAA').AsInteger(),
            'Two groups with the same restriction level must not escalate the result beyond that level');
    end;

    [Test]
    procedure DirectRuleAlreadyStricterThanAnyGroupRuleIsKept()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedDirect('USERE', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);
        SeedMembership('USERE', 'GROUPX');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::ReadOnly);

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Blocked.AsInteger(),
            Resolver.GetEffectiveRestriction('USERE', 'AREAA').AsInteger(),
            'A direct restriction stricter than any of the user''s group restrictions must still apply');
    end;

    [Test]
    procedure GroupRuleStricterThanDirectRuleOverridesIt()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedDirect('USERF', 'AREAA', Enum::"CG X155 Restriction Level"::ReadOnly);
        SeedMembership('USERF', 'GROUPX');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Blocked.AsInteger(),
            Resolver.GetEffectiveRestriction('USERF', 'AREAA').AsInteger(),
            'When a user''s group restriction is stricter than their own direct restriction, the group restriction must win');
    end;

    [Test]
    procedure MembershipInAGroupWithNoRuleForTheAreaFallsBackToDirect()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedDirect('USERG', 'AREAA', Enum::"CG X155 Restriction Level"::ReadOnly);
        SeedMembership('USERG', 'GROUPX');
        // GROUPX carries no restriction at all for AREAA.

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::ReadOnly.AsInteger(),
            Resolver.GetEffectiveRestriction('USERG', 'AREAA').AsInteger(),
            'Belonging to a group with no restriction for the area must not change the user''s direct restriction');
    end;

    [Test]
    procedure NoApplicableRuleAnywhereIsUnrestricted()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        // USERH has no direct restriction and no group membership at all.

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Unrestricted.AsInteger(),
            Resolver.GetEffectiveRestriction('USERH', 'AREAA').AsInteger(),
            'A user with no direct restriction and no group membership must be Unrestricted');
    end;

    [Test]
    procedure RemovingGroupMembershipEndsTheInheritedRestriction()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedMembership('USERI', 'GROUPX');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Blocked.AsInteger(),
            Resolver.GetEffectiveRestriction('USERI', 'AREAA').AsInteger(),
            'A user in a restricted group must see that restriction before the membership is removed');

        GroupMember.Get('USERI', 'GROUPX');
        GroupMember.Delete();

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Unrestricted.AsInteger(),
            Resolver.GetEffectiveRestriction('USERI', 'AREAA').AsInteger(),
            'Removing a user''s group membership must end the restriction that membership provided');
    end;

    [Test]
    procedure UnrelatedUsersGroupMembershipDoesNotLeakToAnotherUser()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedMembership('USERJ', 'GROUPX');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);
        // USERK is not a member of GROUPX or any other group.

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Unrestricted.AsInteger(),
            Resolver.GetEffectiveRestriction('USERK', 'AREAA').AsInteger(),
            'A restriction on a group must apply only to that group''s members, not to every user');
    end;

    [Test]
    procedure RestrictionInOneAreaDoesNotAffectAnotherAreaForTheSameUser()
    var
        UserRestriction: Record "CG X155 User Restriction";
        GroupMember: Record "CG X155 Group Member";
        GroupRestriction: Record "CG X155 Group Restriction";
        Resolver: Codeunit "CG X155 Access Resolver";
    begin
        UserRestriction.DeleteAll();
        GroupMember.DeleteAll();
        GroupRestriction.DeleteAll();

        SeedDirect('USERL', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);
        SeedMembership('USERL', 'GROUPX');
        SeedGroupRule('GROUPX', 'AREAA', Enum::"CG X155 Restriction Level"::Blocked);
        // Neither restriction says anything about AREAB.

        Assert.AreEqual(
            Enum::"CG X155 Restriction Level"::Unrestricted.AsInteger(),
            Resolver.GetEffectiveRestriction('USERL', 'AREAB').AsInteger(),
            'Restrictions recorded for one area must not apply when checking a different area');
    end;
}
