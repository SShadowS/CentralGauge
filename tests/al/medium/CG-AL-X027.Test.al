codeunit 80316 "CG-AL-X027 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure ContiguousDigitsBoundedByLettersAreExtracted()
    var
        Extractor: Codeunit "CG X027 Extractor";
    begin
        // [GIVEN/WHEN/THEN] a single contiguous run of digits bracketed by
        // letters at both ends -- a sanity case any plausible implementation
        // (peel-the-ends or keep-the-digits) must pass.
        Assert.AreEqual(
            42, Extractor.ExtractDigits('INV0042X'),
            'A contiguous digit run bracketed by letters should extract to 42');
    end;

    [Test]
    procedure DigitsInterspersedAcrossTheFullStringAreExtracted()
    var
        Extractor: Codeunit "CG X027 Extractor";
    begin
        // [GIVEN/WHEN/THEN] digit groups separated by letters in the
        // middle of the string, not only at the outer edges -- an
        // implementation that only strips characters from the outer ends
        // leaves the interior letters in place and cannot parse the result.
        Assert.AreEqual(
            1234, Extractor.ExtractDigits('AB12CD34'),
            'Digits separated by letters in the middle should all be collected, in order');
        Assert.AreEqual(
            123, Extractor.ExtractDigits('A1B2C3'),
            'Single digits alternating with single letters should all be collected, in order');
    end;

    [Test]
    procedure DigitsAtBothOuterEdgesWithAnInteriorLetterAreExtracted()
    var
        Extractor: Codeunit "CG X027 Extractor";
    begin
        // [GIVEN/WHEN/THEN] the string already starts and ends with a
        // digit, so there is nothing non-digit sitting at the outer edges
        // to remove -- only a full scan reaches the letter buried between
        // the two digits.
        Assert.AreEqual(
            99, Extractor.ExtractDigits('9X9'),
            'Digits at both outer edges around one interior letter should collect to 99');
    end;

    [Test]
    procedure LeadingDigitRunWithAnInteriorAndTrailingLetterAreExtracted()
    var
        Extractor: Codeunit "CG X027 Extractor";
    begin
        // [GIVEN/WHEN/THEN] a digit run starts the string (nothing to
        // remove at the front) while a letter is buried in the middle and
        // another letter trails the string.
        Assert.AreEqual(
            1234, Extractor.ExtractDigits('12A34B'),
            'A leading digit run plus an interior letter plus a trailing letter should collect to 1234');
    end;
}
