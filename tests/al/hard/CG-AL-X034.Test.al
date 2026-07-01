codeunit 80323 "CG-AL-X034 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure StatusTokenForDraftMatchesDeclaredName()
    var
        Mapper: Codeunit "CG X034 Status Mapper";
        Status: Enum "CG X034 Status";
        Token: Text;
    begin
        // [GIVEN] the Draft value: its declared name and its caption happen
        // to be the identical string, so this is an ALIGNED CONTROL case —
        // both a caption-based and a name-based implementation return the
        // same text here. It must pass either way; it does not discriminate.
        Status := Status::Draft;

        // [WHEN]
        Token := Mapper.StatusToken(Status);

        // [THEN]
        Assert.AreEqual('Draft', Token, 'StatusToken(Draft) must return the declared name');
    end;

    [Test]
    procedure StatusTokenForInProgressMatchesDeclaredNameNotCaption()
    var
        Mapper: Codeunit "CG X034 Status Mapper";
        Status: Enum "CG X034 Status";
        Token: Text;
    begin
        // [GIVEN] the InProgress value: its caption ('In Progress') diverges
        // from its declared name (InProgress) — DISCRIMINATOR case. A
        // Format()-based implementation returns the caption here and fails.
        Status := Status::InProgress;

        // [WHEN]
        Token := Mapper.StatusToken(Status);

        // [THEN]
        Assert.AreEqual('InProgress', Token, 'StatusToken(InProgress) must return the declared name, not the caption');
    end;

    [Test]
    procedure StatusTokenForDoneOKMatchesDeclaredNameNotCaption()
    var
        Mapper: Codeunit "CG X034 Status Mapper";
        Status: Enum "CG X034 Status";
        Token: Text;
    begin
        // [GIVEN] the DoneOK value: its caption ('Completed Successfully')
        // diverges sharply from its declared name (DoneOK) — second,
        // independent DISCRIMINATOR case so the result isn't a coincidence
        // tied to a single pair of strings.
        Status := Status::DoneOK;

        // [WHEN]
        Token := Mapper.StatusToken(Status);

        // [THEN]
        Assert.AreEqual('DoneOK', Token, 'StatusToken(DoneOK) must return the declared name, not the caption');
    end;
}
