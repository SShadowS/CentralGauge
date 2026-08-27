codeunit 71180 "CG X029 Reader"
{
    Access = Internal;

    procedure ReadTwice(var Source: Codeunit "Temp Blob"): Text
    var
        FirstInStream: InStream;
        SecondInStream: InStream;
        FirstContent: Text;
        SecondContent: Text;
    begin
        Source.CreateInStream(FirstInStream, TextEncoding::UTF8);
        FirstInStream.Read(FirstContent);

        Source.CreateInStream(SecondInStream, TextEncoding::UTF8);
        SecondInStream.Read(SecondContent);

        exit(FirstContent + '|' + SecondContent);
    end;
}