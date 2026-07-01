codeunit 80318 "CG-AL-X029 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure BothReadsReturnCompleteHyphenatedContent()
    var
        TempBlob: Codeunit "Temp Blob";
        Reader: Codeunit "CG X029 Reader";
        OutStr: OutStream;
        Content: Text;
    begin
        // [GIVEN] A Temp Blob whose OutStream carries a single line of
        // multi-word text with no newline characters.
        Content := 'HELLO-STREAM-WORLD';
        TempBlob.CreateOutStream(OutStr);
        OutStr.WriteText(Content);

        // [WHEN] ReadTwice reads the blob's content twice.
        // [THEN] Both reads return the complete content, joined by '|'.
        Assert.AreEqual(
            Content + '|' + Content, Reader.ReadTwice(TempBlob),
            'Both reads of the source content should return the complete text, joined by |');
    end;

    [Test]
    procedure BothReadsReturnCompleteSpacedContent()
    var
        TempBlob: Codeunit "Temp Blob";
        Reader: Codeunit "CG X029 Reader";
        OutStr: OutStream;
        Content: Text;
    begin
        // [GIVEN] A different Temp Blob with different multi-word text,
        // so a hardcoded return value cannot coincidentally pass both cases.
        Content := 'ABC 123 XYZ';
        TempBlob.CreateOutStream(OutStr);
        OutStr.WriteText(Content);

        // [WHEN] ReadTwice reads the blob's content twice.
        // [THEN] Both reads return the complete content, joined by '|'.
        Assert.AreEqual(
            Content + '|' + Content, Reader.ReadTwice(TempBlob),
            'Both reads of the source content should return the complete text, joined by |');
    end;
}
